import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { HashEmbeddingClient } from './atlas-embedder'
import { AtlasIndexer, toVectorLiteral, type NeuroQueryResult } from './atlas-indexer'

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rmRf(dir)
  }
})

async function rmRf(dir: string): Promise<void> {
  const { rm } = await import('node:fs/promises')
  await rm(dir, { recursive: true, force: true })
}

type StoredChunk = { id: string; repoPath: string; sha: string; values: readonly unknown[] }

/** In-memory neuro_chunks stand-in so skip/upsert/anchor logic runs for real. */
class FakeNeuroClient {
  readonly queries: { text: string; values?: readonly unknown[] }[] = []
  private readonly chunks: StoredChunk[] = []
  private idCounter = 0

  insertSqls(): { text: string; values?: readonly unknown[] }[] {
    return this.queries.filter((query) => query.text.startsWith('INSERT INTO neuro_chunks'))
  }

  async query(text: string, values?: readonly unknown[]): Promise<NeuroQueryResult> {
    this.queries.push({ text, values })
    if (text.startsWith('SELECT 1 FROM neuro_chunks')) {
      const hit = this.chunks.some(
        (chunk) => chunk.repoPath === values?.[0] && chunk.sha === values?.[1]
      )
      return { rowCount: hit ? 1 : 0, rows: [] }
    }
    if (text.startsWith('INSERT INTO neuro_chunks')) {
      const id = `chunk-${(this.idCounter += 1)}`
      this.chunks.push({
        id,
        repoPath: String(values?.[0]),
        sha: String(values?.[5]),
        values: values ?? []
      })
      return { rowCount: 1, rows: [{ id }] }
    }
    if (text.startsWith('SELECT id FROM neuro_chunks WHERE repo_path')) {
      const anchor = this.chunks.find((chunk) => chunk.repoPath === values?.[0])
      return { rowCount: anchor ? 1 : 0, rows: anchor ? [{ id: anchor.id }] : [] }
    }
    return { rowCount: 1, rows: [] }
  }
}

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'neuro-atlas-'))
  tempDirs.push(root)
  await mkdir(join(root, 'lib'), { recursive: true })
  await writeFile(
    join(root, 'lib', 'alpha.ts'),
    [
      "import { helper } from './helper'",
      "import { Client } from 'pg'",
      '',
      'export function alpha(): number {',
      '  return helper(1)',
      '}'
    ].join('\n')
  )
  await writeFile(
    join(root, 'lib', 'helper.ts'),
    ['export function helper(input: number): number {', '  return input * 2', '}'].join('\n')
  )
  await writeFile(join(root, 'data.json'), '{\n  "ok": true\n}')
  return root
}

describe('AtlasIndexer', () => {
  it('indexes chunks, symbols and resolved import edges with parameterized SQL', async () => {
    const root = await makeRepo()
    const client = new FakeNeuroClient()
    const indexer = new AtlasIndexer({
      root,
      repoPrefix: 'src/packages/demo',
      client,
      embedder: new HashEmbeddingClient(),
      listFiles: async () => ['lib/alpha.ts', 'lib/helper.ts', 'data.json']
    })

    const report = await indexer.indexRepo()
    expect(report.errors).toEqual([])
    expect(report.filesSeen).toBe(3)
    expect(report.filesIndexed).toBe(3)
    // alpha.ts prelude + alpha, helper.ts, data.json
    expect(report.chunks).toBe(4)
    expect(report.symbols).toBe(2)
    expect(report.links).toBe(1)

    const insert = client
      .insertSqls()
      .find(
        (query) =>
          query.values?.[0] === 'src/packages/demo/lib/alpha.ts' && query.values?.[1] === 'alpha'
      )
    expect(insert?.text).toContain('VALUES ($1, $2, $3, $4, $5::vector, $6)')
    expect(insert?.text).toContain('ON CONFLICT (repo_path, kind, symbol) DO UPDATE')
    expect(insert?.values?.[1]).toBe('alpha')
    // Embedding rides in as a pgvector literal parameter, never string-built SQL.
    expect(String(insert?.values?.[4])).toMatch(/^\[[\d.eE+-]+(,[\d.eE+-]+){767}\]$/)
    expect(insert?.values?.[5]).toMatch(/^[0-9a-f]{64}$/)

    const symbolInsert = client.queries.find((query) =>
      query.text.startsWith('INSERT INTO neuro_symbols')
    )
    expect(symbolInsert?.text).toContain('ON CONFLICT (path, name, line_start)')
    expect(symbolInsert?.values?.[1]).toBe('alpha')
    expect(symbolInsert?.values?.[3]).toBe(4)

    const linkInsert = client.queries.find((query) =>
      query.text.startsWith('INSERT INTO neuro_links')
    )
    expect(linkInsert?.values?.[2]).toBe('imports')
    expect(linkInsert?.values?.[3]).toBe(1)
    // src and dst are uuid-ish anchor ids resolved through the anchor lookup, not paths.
    expect(String(linkInsert?.values?.[0])).toMatch(/^chunk-\d+$/)
    expect(String(linkInsert?.values?.[1])).toMatch(/^chunk-\d+$/)
    expect(linkInsert?.values?.[0]).not.toBe(linkInsert?.values?.[1])
  })

  it('skips unchanged files by sha and replaces changed ones', async () => {
    const root = await makeRepo()
    const client = new FakeNeuroClient()
    const options = {
      root,
      repoPrefix: '',
      client,
      embedder: new HashEmbeddingClient(),
      listFiles: (async () => ['lib/helper.ts']) as (fsRoot: string) => Promise<string[]>
    }
    const first = await new AtlasIndexer(options).indexRepo()
    expect(first.filesIndexed).toBe(1)
    expect(first.filesSkippedUnchanged).toBe(0)

    const insertsAfterFirst = client.insertSqls().length
    const second = await new AtlasIndexer(options).indexRepo()
    expect(second.filesSkippedUnchanged).toBe(1)
    expect(second.filesIndexed).toBe(0)
    expect(client.insertSqls().length).toBe(insertsAfterFirst)

    const { writeFile: rewrite } = await import('node:fs/promises')
    await rewrite(
      join(root, 'lib', 'helper.ts'),
      'export function helper(): number {\n  return 3\n}'
    )
    const third = await new AtlasIndexer(options).indexRepo()
    expect(third.filesIndexed).toBe(1)
    const deleteSqls = client.queries.filter((query) =>
      query.text.startsWith('DELETE FROM neuro_chunks')
    )
    expect(deleteSqls.length).toBe(2)
    expect(client.queries.some((query) => query.text.includes('indexed_at = now()'))).toBe(true)
  })

  it('skips oversize files without aborting the run', async () => {
    const root = await makeRepo()
    await writeFile(join(root, 'lib', 'huge.ts'), 'x'.repeat(600_000))
    const client = new FakeNeuroClient()
    const report = await new AtlasIndexer({
      root,
      client,
      embedder: new HashEmbeddingClient(),
      listFiles: async () => ['lib/huge.ts', 'data.json'],
      maxFileBytes: 512_000
    }).indexRepo()
    expect(report.filesSkippedOversize).toBe(1)
    expect(report.filesIndexed).toBe(1)
    expect(client.insertSqls().every((query) => query.values?.[0] !== 'lib/huge.ts')).toBe(true)
  })

  it('collects errors and keeps indexing later files', async () => {
    const root = await makeRepo()
    const failing = new HashEmbeddingClient()
    const embedder = {
      async embed(texts: readonly string[]) {
        if (texts.some((text) => text.includes('lib/helper.ts'))) {
          throw new Error('embedder exploded')
        }
        return failing.embed(texts)
      }
    }
    const report = await new AtlasIndexer({
      root,
      client: new FakeNeuroClient(),
      embedder,
      listFiles: async () => ['lib/helper.ts', 'data.json']
    }).indexRepo()
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toContain('embedder exploded')
    expect(report.filesIndexed).toBe(1)
  })
})

describe('toVectorLiteral', () => {
  it('formats a pgvector text literal', () => {
    expect(toVectorLiteral([1, 2.5, -3])).toBe('[1,2.5,-3]')
  })
})
