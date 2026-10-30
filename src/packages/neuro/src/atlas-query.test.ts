import { describe, expect, it } from 'vitest'

import { HashEmbeddingClient } from './atlas-embedder'
import type { NeuroQueryResult } from './atlas-indexer'
import { AtlasQuery } from './atlas-query'

class RecordingClient {
  last: { text: string; values?: readonly unknown[] } | null = null

  async query(text: string, values?: readonly unknown[]): Promise<NeuroQueryResult> {
    this.last = { text, values }
    return {
      rowCount: 1,
      rows: [
        {
          id: 'chunk-1',
          repo_path: 'src/packages/neuro/src/atlas-indexer.ts',
          symbol: 'AtlasIndexer',
          kind: 'code',
          content: 'export class AtlasIndexer {}',
          distance: 0.25
        }
      ]
    }
  }
}

describe('AtlasQuery.semantic', () => {
  it('embeds the query and runs parameterized cosine top-K with filters', async () => {
    const client = new RecordingClient()
    const hits = await new AtlasQuery(client, new HashEmbeddingClient()).semantic(
      'indexer orchestration',
      {
        limit: 5,
        pathPrefix: 'src/packages/neuro',
        kind: 'code'
      }
    )
    const text = client.last?.text ?? ''
    expect(text).toContain('embedding <=> $1::vector')
    expect(text).toContain('ORDER BY embedding <=> $1::vector')
    expect(text).toContain('LIMIT $4')
    expect(text).toContain('repo_path LIKE $2')
    expect(client.last?.values?.[0]).toMatch(/^\[[\d.eE+-]+(,[\d.eE+-]+){767}\]$/)
    expect(client.last?.values?.[1]).toBe('src/packages/neuro%')
    expect(client.last?.values?.[2]).toBe('code')
    expect(client.last?.values?.[3]).toBe(5)
    expect(hits).toEqual([
      {
        id: 'chunk-1',
        repoPath: 'src/packages/neuro/src/atlas-indexer.ts',
        symbol: 'AtlasIndexer',
        kind: 'code',
        content: 'export class AtlasIndexer {}',
        distance: 0.25
      }
    ])
  })

  it('sends NULL filters when unspecified and rejects empty queries', async () => {
    const client = new RecordingClient()
    await new AtlasQuery(client, new HashEmbeddingClient()).semantic('  ')
    expect(client.last).toBeNull()
    await new AtlasQuery(client, new HashEmbeddingClient()).semantic('atlas')
    expect(client.last?.values?.[1]).toBeNull()
    expect(client.last?.values?.[2]).toBeNull()
    expect(client.last?.values?.[3]).toBe(10)
  })
})

describe('AtlasQuery.symbol', () => {
  it('looks up exact names with optional path filter', async () => {
    const client = new RecordingClient()
    await new AtlasQuery(client, new HashEmbeddingClient()).symbol('AtlasIndexer', {
      pathPrefix: 'src/packages/neuro',
      limit: 3
    })
    const text = client.last?.text ?? ''
    expect(text).toContain('FROM neuro_symbols')
    expect(text).toContain('WHERE name = $1 AND ($2::text IS NULL OR path LIKE $2)')
    expect(text).toContain('ORDER BY path, line_start')
    expect(client.last?.values).toEqual(['AtlasIndexer', 'src/packages/neuro%', 3])
  })
})
