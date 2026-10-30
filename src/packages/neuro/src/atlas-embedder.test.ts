import { describe, expect, it } from 'vitest'

import {
  embedBatches,
  HashEmbeddingClient,
  NEURO_EMBEDDING_DIM,
  OllamaEmbeddingClient,
  withEmbedRetry,
  type EmbeddingClient
} from './atlas-embedder'

function l2Norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
}

describe('HashEmbeddingClient', () => {
  it('is deterministic, 768-dim and L2-normalized', async () => {
    const [first] = await new HashEmbeddingClient().embed(['export function atlasGreet() {}'])
    const [second] = await new HashEmbeddingClient().embed(['export function atlasGreet() {}'])
    const [other] = await new HashEmbeddingClient().embed(['export class AtlasIndex {}'])
    expect(first).toHaveLength(NEURO_EMBEDDING_DIM)
    expect(first).toEqual(second)
    expect(first).not.toEqual(other)
    expect(Math.abs(l2Norm(first) - 1)).toBeLessThan(1e-9)
  })

  it('returns no vectors for no texts', async () => {
    expect(await new HashEmbeddingClient().embed([])).toEqual([])
  })
})

describe('withEmbedRetry', () => {
  const sleeps: number[] = []

  function flakyClient(failuresLeft: number): EmbeddingClient {
    return {
      async embed(texts) {
        if (failuresLeft > 0) {
          failuresLeft -= 1
          throw new Error(`transient failure (${failuresLeft} left)`)
        }
        return texts.map((text) => [text.length])
      }
    }
  }

  it('retries transient failures with exponential backoff', async () => {
    const client = withEmbedRetry(flakyClient(2), {
      attempts: 3,
      baseDelayMs: 50,
      sleep: async (ms) => {
        sleeps.push(ms)
      }
    })
    expect(await client.embed(['abc'])).toEqual([[3]])
    expect(sleeps).toEqual([50, 100])
  })

  it('rethrows after the final attempt', async () => {
    const client = withEmbedRetry(flakyClient(99), { attempts: 2, sleep: async () => {} })
    await expect(client.embed(['x'])).rejects.toThrow('transient failure')
  })
})

describe('embedBatches', () => {
  it('splits into sequential batches preserving order', async () => {
    const seenBatches: number[][] = []
    const client: EmbeddingClient = {
      async embed(texts) {
        seenBatches.push(texts.map((text) => text.length))
        return texts.map((text) => [text.length])
      }
    }
    const vectors = await embedBatches(client, ['a', 'bb', 'ccc', 'dddd'], { batchSize: 3 })
    expect(seenBatches).toEqual([[1, 2, 3], [4]])
    expect(vectors).toEqual([[1], [2], [3], [4]])
  })
})

describe('OllamaEmbeddingClient', () => {
  function fakeFetch(body: unknown, status = 200): { fetchFn: typeof fetch; bodies: unknown[] } {
    const bodies: unknown[] = []
    const fetchFn = (async (_url: unknown, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? 'null'))
      return new Response(JSON.stringify(body), { status })
    }) as typeof fetch
    return { fetchFn, bodies }
  }

  it('posts model+input to /api/embed and returns validated embeddings', async () => {
    const vector = Array.from({ length: NEURO_EMBEDDING_DIM }, (_, i) => i / 1e6)
    const { fetchFn, bodies } = fakeFetch({ embeddings: [vector, vector] })
    const client = new OllamaEmbeddingClient({ fetchFn, host: 'http://127.0.0.1:11434/' })
    expect(await client.embed(['one', 'two'])).toEqual([vector, vector])
    expect(bodies[0]).toEqual({ model: 'nomic-embed-text', input: ['one', 'two'] })
  })

  it('rejects wrong dimension or count instead of shipping bad vectors', async () => {
    const wrongDim = fakeFetch({ embeddings: [[0.1, 0.2]] })
    await expect(
      new OllamaEmbeddingClient({ fetchFn: wrongDim.fetchFn }).embed(['x'])
    ).rejects.toThrow(/malformed embeddings/)
    const wrongCount = fakeFetch({ embeddings: [] })
    await expect(
      new OllamaEmbeddingClient({ fetchFn: wrongCount.fetchFn }).embed(['x'])
    ).rejects.toThrow(/malformed embeddings/)
  })

  it('surfaces non-2xx responses as errors', async () => {
    const { fetchFn } = fakeFetch({ error: 'model not found' }, 404)
    await expect(new OllamaEmbeddingClient({ fetchFn }).embed(['x'])).rejects.toThrow(/status 404/)
  })
})
