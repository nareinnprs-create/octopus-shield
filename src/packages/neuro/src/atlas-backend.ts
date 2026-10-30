import type { AtlasQuery, SemanticOptions, SymbolOptions } from './atlas-query'
import type { NeuroPgHandle } from './atlas-store-pg'

/** Shapes expected by the renderer Brain Atlas IPC (src/shared/neuro-atlas-contract.ts). */
export type AtlasBackendNode = {
  id: string
  kind: 'file' | 'symbol'
  label: string
  path?: string
  lineStart?: number
  lineEnd?: number
}

export type AtlasBackendEdge = {
  source: string
  target: string
  kind: 'imports' | 'calls' | 'semantic' | 'audit'
  strength: number
}

export type AtlasBackendGraph = {
  nodes: AtlasBackendNode[]
  edges: AtlasBackendEdge[]
  generatedAtEpochMs: number
}

export type AtlasBackendStatus = {
  available: boolean
  state: 'unavailable' | 'idle' | 'indexing' | 'error'
  detail?: string
  fileCount?: number
  chunkCount?: number
  lastIndexedAtEpochMs?: number
}

export type AtlasQueryBackend = {
  query: {
    semantic(text: string, options?: { limit?: number; pathPrefix?: string }): Promise<
      { id: string; kind: 'file'; label: string; path: string; score: number }[]
    >
    symbol(name: string, options?: { limit?: number }): Promise<
      { id: string; kind: 'symbol'; label: string; path: string; lineStart: number; lineEnd: number; score: number }[]
    >
    graph(scope?: { repoPath?: string; limit?: number }): Promise<AtlasBackendGraph>
    status(): Promise<AtlasBackendStatus>
  }
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

/** Adapts AtlasQuery + the nucleus handle to the renderer Brain Atlas backend contract. */
export function createAtlasQueryBackend(atlasQuery: AtlasQuery, pg: Pick<NeuroPgHandle, 'client'>): AtlasQueryBackend {
  const semantic = async (text: string, options?: SemanticOptions & { pathPrefix?: string }) => {
    const hits = await atlasQuery.semantic(text, options)
    return hits.map((hit) => ({
      id: hit.id,
      kind: 'file' as const,
      label: hit.symbol || hit.repoPath,
      path: hit.repoPath,
      // distance (pgvector <=>) → relevance; 0 distance = exact.
      score: clamp01(1 - hit.distance)
    }))
  }
  const symbol = async (name: string, options?: SymbolOptions) => {
    const hits = await atlasQuery.symbol(name, options)
    return hits.map((hit) => ({
      id: hit.id,
      kind: 'symbol' as const,
      label: hit.name,
      path: hit.path,
      lineStart: hit.lineStart,
      lineEnd: hit.lineEnd,
      score: 1
    }))
  }
  const graph = async (scope?: { repoPath?: string; limit?: number }): Promise<AtlasBackendGraph> => {
    const limit = Math.min(scope?.limit ?? 400, 500)
    const prefix = scope?.repoPath ?? ''
    const nodesResult = await pg.client.query(
      `SELECT id, repo_path, symbol, kind FROM neuro_chunks
       WHERE ($1 = '' OR repo_path LIKE $1 || '%')
       ORDER BY indexed_at DESC LIMIT $2`,
      [prefix, limit]
    )
    const ids = (nodesResult.rows as { id: string }[]).map((row) => row.id)
    const nodes: AtlasBackendNode[] = (nodesResult.rows as { id: string; repo_path: string; symbol: string; kind: string }[]).map(
      (row) => ({ id: row.id, kind: 'file', label: row.symbol || row.repo_path, path: row.repo_path })
    )
    const edges: AtlasBackendEdge[] = []
    if (ids.length > 0) {
      const links = await pg.client.query(
        `SELECT src, dst FROM neuro_links WHERE kind = 'imports' AND src = ANY($1::uuid[]) AND dst = ANY($1::uuid[])`,
        [ids]
      )
      for (const row of links.rows as { src: string; dst: string }[]) {
        edges.push({ source: row.src, target: row.dst, kind: 'imports', strength: 1 })
      }
    }
    return { nodes, edges, generatedAtEpochMs: Date.now() }
  }
  const status = async (): Promise<AtlasBackendStatus> => {
    const counts = await pg.client.query(
      `SELECT
         (SELECT COUNT(DISTINCT repo_path) FROM neuro_chunks) AS files,
         (SELECT COUNT(*) FROM neuro_chunks) AS chunks,
         (SELECT MAX(indexed_at) FROM neuro_chunks) AS last_indexed`
    )
    const row = (counts.rows[0] ?? {}) as { files?: string | number; chunks?: string | number; last_indexed?: string }
    const fileCount = Number(row.files ?? 0)
    const chunkCount = Number(row.chunks ?? 0)
    if (fileCount === 0) {
      return { available: false, state: 'idle', detail: 'atlas empty — run the indexer', fileCount: 0, chunkCount: 0 }
    }
    return {
      available: true,
      state: 'idle',
      fileCount,
      chunkCount,
      lastIndexedAtEpochMs: row.last_indexed ? new Date(row.last_indexed).getTime() : undefined
    }
  }
  const semanticBackend = async (text: string, options?: { limit?: number; pathPrefix?: string }) => semantic(text, options)
  const symbolBackend = async (name: string, options?: { limit?: number }) => symbol(name, options)
  return {
    query: {
      semantic: semanticBackend,
      symbol: symbolBackend,
      graph,
      status
    }
  }
}
