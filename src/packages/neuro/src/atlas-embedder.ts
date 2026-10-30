import { createHash } from 'node:crypto'

/**
 * Embedding adapters for the Brain Atlas. The structural surface is
 * `EmbeddingClient` (embed texts → vectors); every consumer (indexer,
 * query, CLI, tests) takes one injected, so swapping models or providers is
 * a single adapter.
 *
 * Default production adapter: Ollama /api/embed with nomic-embed-text
 * (768 dims — see infra/db/neuro.sql for why the columns are vector(768)).
 * HashEmbeddingClient is a DETERMINISTIC DEV-ONLY PLACEHOLDER for boxes
 * without Ollama: it makes the pipeline runnable offline end-to-end but its
 * vectors are not semantic. shortcut: hash "embeddings" rank nothing
 * semantically; swap to OllamaEmbeddingClient (or any real client) before
 * relying on query results.
 */

export const NEURO_EMBEDDING_DIM = 768

export type EmbeddingClient = {
  embed(texts: readonly string[]): Promise<number[][]>
}

export type OllamaEmbeddingOptions = {
  model?: string
  host?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

const DEFAULT_OLLAMA_MODEL = 'nomic-embed-text'
const DEFAULT_OLLAMA_HOST = 'http://127.0.0.1:11434'
const DEFAULT_TIMEOUT_MS = 60_000

export class OllamaEmbeddingClient implements EmbeddingClient {
  private readonly model: string
  private readonly host: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number

  constructor(options: OllamaEmbeddingOptions = {}) {
    this.model = options.model ?? DEFAULT_OLLAMA_MODEL
    this.host = (options.host ?? DEFAULT_OLLAMA_HOST).replace(/\/$/, '')
    this.fetchFn = options.fetchFn ?? fetch
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return []
    }
    const response = await this.fetchFn(`${this.host}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: [...texts] }),
      signal: AbortSignal.timeout(this.timeoutMs)
    })
    if (!response.ok) {
      throw new Error(
        `ollama /api/embed failed with status ${response.status} (model ${this.model})`
      )
    }
    const body = (await response.json()) as { embeddings?: unknown }
    const embeddings = body.embeddings
    if (
      !Array.isArray(embeddings) ||
      embeddings.length !== texts.length ||
      !embeddings.every(
        (vector) =>
          Array.isArray(vector) &&
          vector.length === NEURO_EMBEDDING_DIM &&
          vector.every((value) => typeof value === 'number' && Number.isFinite(value))
      )
    ) {
      throw new Error(
        `ollama /api/embed returned malformed embeddings (expected ${texts.length} x ${NEURO_EMBEDDING_DIM}); check the model's dimension`
      )
    }
    return embeddings
  }
}

/**
 * Deterministic 768-dim vector derived from sha256 of the text, L2-normalized.
 * Same text → same vector, different text → (almost surely) different vector.
 */
export function hashEmbed(text: string): number[] {
  let seed = createHash('sha256').update(`neuro-dev-embed-v1\n${text}`, 'utf8').digest()
  const values: number[] = []
  while (values.length < NEURO_EMBEDDING_DIM) {
    for (const byte of seed) {
      values.push(byte / 127.5 - 1)
    }
    if (values.length < NEURO_EMBEDDING_DIM) {
      seed = createHash('sha256').update(seed).digest()
    }
  }
  const vector = values.slice(0, NEURO_EMBEDDING_DIM)
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
  return vector.map((value) => value / norm)
}

export class HashEmbeddingClient implements EmbeddingClient {
  async embed(texts: readonly string[]): Promise<number[][]> {
    return texts.map(hashEmbed)
  }
}

export type RetryOptions = {
  attempts?: number
  baseDelayMs?: number
  sleep?: (ms: number) => Promise<void>
}

const DEFAULT_ATTEMPTS = 3
const DEFAULT_BASE_DELAY_MS = 100

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

/** Exponential backoff around any client's embed; rethrows after `attempts` failures. */
export function withEmbedRetry(
  client: EmbeddingClient,
  options: RetryOptions = {}
): EmbeddingClient {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const sleep = options.sleep ?? defaultSleep
  return {
    async embed(texts: readonly string[]): Promise<number[][]> {
      let lastError: unknown
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await client.embed(texts)
        } catch (error) {
          lastError = error
          if (attempt + 1 < attempts) {
            await sleep(baseDelayMs * 2 ** attempt)
          }
        }
      }
      throw lastError
    }
  }
}

export type BatchOptions = {
  batchSize?: number
}

const DEFAULT_BATCH_SIZE = 32

/** Sequential batching keeps request bodies bounded; order is preserved. */
export async function embedBatches(
  client: EmbeddingClient,
  texts: readonly string[],
  options: BatchOptions = {}
): Promise<number[][]> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  const vectors: number[][] = []
  for (let start = 0; start < texts.length; start += batchSize) {
    vectors.push(...(await client.embed(texts.slice(start, start + batchSize))))
  }
  return vectors
}
