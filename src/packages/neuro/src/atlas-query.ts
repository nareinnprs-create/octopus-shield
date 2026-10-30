import { NEURO_EMBEDDING_DIM, type EmbeddingClient } from './atlas-embedder'
import { toVectorLiteral, type NeuroClient } from './atlas-indexer'

export type SemanticHit = {
  id: string
  repoPath: string
  symbol: string
  kind: string
  content: string
  distance: number
}

export type SymbolHit = {
  id: string
  path: string
  name: string
  kind: string
  lineStart: number
  lineEnd: number
  signature: string
}

export type SemanticOptions = {
  limit?: number
  /** Repo-relative POSIX prefix; becomes an escaped LIKE prefix filter. */
  pathPrefix?: string
  kind?: string
}

export type SymbolOptions = {
  limit?: number
  pathPrefix?: string
}

const DEFAULT_LIMIT = 10
const DEFAULT_SYMBOL_LIMIT = 50

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * Read side of the Brain Atlas (N3.3 consumes this). Semantic search embeds
 * the query then does cosine top-K via pgvector's <=>; semantic edges stay
 * query-time, never stored. Same structural NeuroClient as the indexer, so
 * tests substitute fakes.
 */
export class AtlasQuery {
  private readonly client: NeuroClient
  private readonly embedder: EmbeddingClient

  constructor(client: NeuroClient, embedder: EmbeddingClient) {
    this.client = client
    this.embedder = embedder
  }

  async semantic(queryText: string, options: SemanticOptions = {}): Promise<SemanticHit[]> {
    if (queryText.trim() === '') {
      return []
    }
    const [vector] = await this.embedder.embed([queryText])
    if (vector.length !== NEURO_EMBEDDING_DIM) {
      throw new Error(`query embedding dim ${vector.length} != ${NEURO_EMBEDDING_DIM}`)
    }
    const pathPattern = options.pathPrefix ? `${escapeLike(options.pathPrefix)}%` : null
    const kind = options.kind ?? null
    const result = await this.client.query(
      `SELECT id, repo_path, symbol, kind, content, embedding <=> $1::vector AS distance
FROM neuro_chunks
WHERE embedding IS NOT NULL AND ($2::text IS NULL OR repo_path LIKE $2) AND ($3::text IS NULL OR kind = $3)
ORDER BY embedding <=> $1::vector
LIMIT $4`,
      [toVectorLiteral(vector), pathPattern, kind, options.limit ?? DEFAULT_LIMIT]
    )
    return result.rows.map((row) => ({
      id: String(row.id),
      repoPath: String(row.repo_path),
      symbol: String(row.symbol),
      kind: String(row.kind),
      content: String(row.content),
      distance: Number(row.distance)
    }))
  }

  async symbol(name: string, options: SymbolOptions = {}): Promise<SymbolHit[]> {
    if (name.trim() === '') {
      return []
    }
    const pathPattern = options.pathPrefix ? `${escapeLike(options.pathPrefix)}%` : null
    const result = await this.client.query(
      `SELECT id, path, name, kind, line_start, line_end, signature
FROM neuro_symbols
WHERE name = $1 AND ($2::text IS NULL OR path LIKE $2)
ORDER BY path, line_start
LIMIT $3`,
      [name, pathPattern, options.limit ?? DEFAULT_SYMBOL_LIMIT]
    )
    return result.rows.map((row) => ({
      id: String(row.id),
      path: String(row.path),
      name: String(row.name),
      kind: String(row.kind),
      lineStart: Number(row.line_start),
      lineEnd: Number(row.line_end),
      signature: String(row.signature)
    }))
  }
}
