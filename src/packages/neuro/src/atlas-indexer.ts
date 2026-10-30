import { readdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { runProcess } from '@shield/process-host'

import {
  chunkRepoFile,
  extractSymbols,
  isIndexablePath,
  sha256Hex,
  type Chunk,
  type SymbolRecord
} from './atlas-chunker'
import { embedBatches, NEURO_EMBEDDING_DIM, type EmbeddingClient } from './atlas-embedder'
import { extractImports, resolveImportSpec } from './atlas-imports'

/** Minimal structural pg surface; tests substitute fakes (audit-store pattern). */
export type NeuroClient = {
  query(text: string, values?: readonly unknown[]): Promise<NeuroQueryResult>
}

export type NeuroQueryResult = {
  rowCount: number | null
  rows: Record<string, unknown>[]
}

export type IndexReport = {
  filesSeen: number
  filesIndexed: number
  filesSkippedUnchanged: number
  filesSkippedOversize: number
  chunks: number
  symbols: number
  links: number
  errors: string[]
}

export type AtlasIndexerOptions = {
  /** Absolute fs directory being indexed (repo root or a bounded subdirectory). */
  root: string
  /** Repo-relative POSIX prefix stored paths get; '' when root IS the repo root. */
  repoPrefix?: string
  client: NeuroClient
  embedder: EmbeddingClient
  /** Repo-relative-to-root POSIX paths. Default: git ls-files (honors .gitignore), fs-walk fallback. */
  listFiles?: (fsRoot: string) => Promise<string[]>
  maxFileBytes?: number
  embedBatchSize?: number
}

const DEFAULT_MAX_FILE_BYTES = 512_000

const UNCHANGED_SQL = 'SELECT 1 FROM neuro_chunks WHERE repo_path = $1 AND sha = $2 LIMIT 1'
const DELETE_CHUNKS_SQL = 'DELETE FROM neuro_chunks WHERE repo_path = $1'
const DELETE_SYMBOLS_SQL = 'DELETE FROM neuro_symbols WHERE path = $1'
const INSERT_CHUNK_SQL =
  'INSERT INTO neuro_chunks (repo_path, symbol, kind, content, embedding, sha) VALUES ($1, $2, $3, $4, $5::vector, $6) ON CONFLICT (repo_path, kind, symbol) DO UPDATE SET content = EXCLUDED.content, embedding = EXCLUDED.embedding, sha = EXCLUDED.sha, indexed_at = now() RETURNING id'
const INSERT_SYMBOL_SQL =
  'INSERT INTO neuro_symbols (path, name, kind, line_start, line_end, signature, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7::vector) ON CONFLICT (path, name, line_start) DO UPDATE SET kind = EXCLUDED.kind, line_end = EXCLUDED.line_end, signature = EXCLUDED.signature, embedding = EXCLUDED.embedding'
// File-grained imports anchor: the file-level chunk ('') when present, else any chunk of the file.
const ANCHOR_SQL =
  "SELECT id FROM neuro_chunks WHERE repo_path = $1 ORDER BY (symbol = '') DESC LIMIT 1"
const INSERT_LINK_SQL =
  'INSERT INTO neuro_links (src, dst, kind, strength) VALUES ($1, $2, $3, $4) ON CONFLICT (src, dst, kind) DO UPDATE SET strength = EXCLUDED.strength'

/** pgvector text literal; passed as a parameter cast ::vector (never string-built SQL). */
export function toVectorLiteral(vector: readonly number[]): string {
  return `[${vector.join(',')}]`
}

/** Embedding text for a chunk: path + symbol header in front of raw content. */
export function chunkEmbedText(chunk: Chunk): string {
  const header = `[${chunk.kind}] ${chunk.path}${chunk.symbol ? ` :: ${chunk.symbol}` : ''}`
  return `${header}\n${chunk.content}`
}

const FALLBACK_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'out',
  '.cache',
  'coverage',
  '.tmp'
])

/** Exact .gitignore honoring with zero deps; falls back to a filtered fs walk outside git repos. */
export async function listGitFiles(fsRoot: string): Promise<string[]> {
  try {
    const listing = await runProcess({
      program: 'git',
      args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      cwd: fsRoot,
      timeoutMs: 60_000,
      maxOutputBytes: 64 * 1024 * 1024
    })
    if (listing.code === 0 && !listing.timedOut) {
      return listing.stdout
        .split('\0')
        .filter((entry) => entry.length > 0 && isIndexablePath(entry))
    }
  } catch {
    // Not a git repo or git missing: walk the filesystem below.
  }
  return walkFiles(fsRoot)
}

async function walkFiles(dir: string, base = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!FALLBACK_IGNORED_DIRS.has(entry.name)) {
        files.push(...(await walkFiles(entryPath, base)))
      }
    } else if (entry.isFile()) {
      const relPath = relative(base, entryPath).split(sep).join('/')
      if (isIndexablePath(relPath)) {
        files.push(relPath)
      }
    }
  }
  return files
}

function joinRepoPath(repoPrefix: string, relPath: string): string {
  return repoPrefix === '' ? relPath : `${repoPrefix}/${relPath}`
}

/**
 * Incremental Brain Atlas indexer (infra/db/neuro.sql). Per file: hash →
 * skip when a chunk row with the same file sha exists → otherwise replace
 * the path's chunks/symbols (links cascade via FK), embed in batches, upsert
 * parameterized rows, and store resolved import edges. Sequential by design:
 * bounded dirs, retryable runs, no write contention.
 */
export class AtlasIndexer {
  private readonly root: string
  private readonly repoPrefix: string
  private readonly client: NeuroClient
  private readonly embedder: EmbeddingClient
  private readonly listFiles: (fsRoot: string) => Promise<string[]>
  private readonly maxFileBytes: number
  private readonly embedBatchSize: number

  constructor(options: AtlasIndexerOptions) {
    this.root = options.root
    this.repoPrefix = options.repoPrefix ?? ''
    this.client = options.client
    this.embedder = options.embedder
    this.listFiles = options.listFiles ?? listGitFiles
    this.maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    this.embedBatchSize = options.embedBatchSize ?? 32
  }

  async indexRepo(): Promise<IndexReport> {
    const report: IndexReport = {
      filesSeen: 0,
      filesIndexed: 0,
      filesSkippedUnchanged: 0,
      filesSkippedOversize: 0,
      chunks: 0,
      symbols: 0,
      links: 0,
      errors: []
    }
    const listing = await this.listFiles(this.root)
    const pendingLinks: { fromPath: string; spec: string }[] = []
    for (const relPath of [...listing].sort()) {
      if (!isIndexablePath(relPath)) {
        continue
      }
      report.filesSeen += 1
      const repoPath = joinRepoPath(this.repoPrefix, relPath)
      try {
        pendingLinks.push(...(await this.indexFile(relPath, repoPath, report)))
      } catch (error) {
        report.errors.push(`${repoPath}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    // Second phase: forward references (a file importing a later-sorted file)
    // only resolve once every file's chunks exist.
    report.links += await this.resolveImportLinks(pendingLinks)
    return report
  }

  private async indexFile(
    relPath: string,
    repoPath: string,
    report: IndexReport
  ): Promise<{ fromPath: string; spec: string }[]> {
    const content = (await readFile(join(this.root, relPath))).toString('utf8')
    if (Buffer.byteLength(content, 'utf8') > this.maxFileBytes) {
      report.filesSkippedOversize += 1
      return []
    }
    const fileSha = sha256Hex(content)
    const unchanged = await this.client.query(UNCHANGED_SQL, [repoPath, fileSha])
    if ((unchanged.rowCount ?? 0) > 0) {
      report.filesSkippedUnchanged += 1
      return []
    }
    await this.client.query(DELETE_CHUNKS_SQL, [repoPath])
    await this.client.query(DELETE_SYMBOLS_SQL, [repoPath])

    const chunks = chunkRepoFile(repoPath, content)
    const chunkVectors = await embedBatches(this.embedder, chunks.map(chunkEmbedText), {
      batchSize: this.embedBatchSize
    })
    for (const [index, chunk] of chunks.entries()) {
      await this.insertChunk(chunk, chunkVectors[index], fileSha)
    }

    const symbolRecords = extractSymbols(repoPath, content)
    const symbolVectors = await embedBatches(
      this.embedder,
      symbolRecords.map((record) => record.signature),
      { batchSize: this.embedBatchSize }
    )
    for (const [index, record] of symbolRecords.entries()) {
      await this.insertSymbol(repoPath, record, symbolVectors[index])
    }

    report.chunks += chunks.length
    report.symbols += symbolRecords.length
    report.filesIndexed += 1
    return extractImports(content).map((spec) => ({ fromPath: repoPath, spec }))
  }

  private async insertChunk(chunk: Chunk, vector: number[], fileSha: string): Promise<void> {
    if (vector.length !== NEURO_EMBEDDING_DIM) {
      throw new Error(
        `embedding dim ${vector.length} != ${NEURO_EMBEDDING_DIM}; column enforces vector(768)`
      )
    }
    await this.client.query(INSERT_CHUNK_SQL, [
      chunk.path,
      chunk.symbol,
      chunk.kind,
      chunk.content,
      toVectorLiteral(vector),
      fileSha
    ])
  }

  private async insertSymbol(path: string, record: SymbolRecord, vector: number[]): Promise<void> {
    if (vector.length !== NEURO_EMBEDDING_DIM) {
      throw new Error(
        `embedding dim ${vector.length} != ${NEURO_EMBEDDING_DIM}; column enforces vector(768)`
      )
    }
    await this.client.query(INSERT_SYMBOL_SQL, [
      path,
      record.name,
      record.kind,
      record.lineStart,
      record.lineEnd,
      record.signature,
      toVectorLiteral(vector)
    ])
  }

  /** Import specs → resolved repo paths → imports edges between file anchors. */
  private async resolveImportLinks(
    pending: { fromPath: string; spec: string }[]
  ): Promise<number> {
    const seen = new Set<string>()
    let links = 0
    for (const { fromPath, spec } of pending) {
      const target = resolveImportSpec(fromPath, spec, (candidate) =>
        existsSync(join(this.root, this.stripRepoPrefix(candidate)))
      )
      if (!target || target === fromPath) {
        continue
      }
      const [srcId, dstId] = await Promise.all([
        this.fileAnchorId(fromPath),
        this.fileAnchorId(target)
      ])
      if (!srcId || !dstId) {
        continue
      }
      const pair = `${srcId}|${dstId}`
      if (seen.has(pair)) {
        continue
      }
      seen.add(pair)
      await this.client.query(INSERT_LINK_SQL, [srcId, dstId, 'imports', 1])
      links += 1
    }
    return links
  }

  private stripRepoPrefix(repoPath: string): string {
    if (this.repoPrefix === '') {
      return repoPath
    }
    const prefix = `${this.repoPrefix}/`
    return repoPath.startsWith(prefix) ? repoPath.slice(prefix.length) : repoPath
  }

  private async fileAnchorId(repoPath: string): Promise<string | null> {
    const result = await this.client.query(ANCHOR_SQL, [repoPath])
    const id = result.rows[0]?.id
    return typeof id === 'string' ? id : null
  }
}
