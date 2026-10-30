import { describe, expect, it } from 'vitest'

import { chunkRepoFile, extractSymbols, sha256Hex } from './atlas-chunker'
import { extractImports, resolveImportSpec } from './atlas-imports'

const TS_SAMPLE = `// prelude comment
import { runProcess } from '@shield/process-host'

export function atlasGreet(name: string): string {
  return \`hello \${name}\` // brace } inside template
}

export class AtlasIndex {
  private depth = 0

  measure(input: string): number {
    const nested = { brace: '{' }
    return nested.brace.length + this.depth
  }
}

export interface AtlasOptions {
  root: string
}

export type AtlasMode = 'full' | 'incremental'

export const DEFAULT_MODE: AtlasMode = 'full'
`

const MD_SAMPLE = `# Top heading

Intro paragraph before the next section.

## Setup steps

Install dependencies and run tests.

## Usage

Call the CLI.
`

describe('chunkRepoFile', () => {
  it('splits TS on column-0 declarations and keeps the prelude as a file-level chunk', () => {
    const chunks = chunkRepoFile('src/atlas-sample.ts', TS_SAMPLE)
    expect(chunks.map((chunk) => [chunk.symbol, chunk.kind])).toEqual([
      ['', 'code'],
      ['atlasGreet', 'code'],
      ['AtlasIndex', 'code'],
      ['AtlasOptions', 'code'],
      ['AtlasMode', 'code'],
      ['DEFAULT_MODE', 'code']
    ])
    const [prelude, greet, index, options] = chunks
    expect(prelude.lineStart).toBe(1)
    expect(prelude.lineEnd).toBe(2)
    expect(prelude.content).toContain('import { runProcess }')
    expect(greet.content).toContain('return `hello ${name}`')
    expect(index.lineStart).toBe(8)
    expect(index.lineEnd).toBe(15)
    expect(index.content).toContain('nested.brace.length')
    expect(options.content).toBe('export interface AtlasOptions {\n  root: string\n}')
    for (const chunk of chunks) {
      expect(chunk.sha256).toBe(sha256Hex(chunk.content))
      expect(chunk.path).toBe('src/atlas-sample.ts')
    }
  })

  it('splits markdown on headings, one chunk per section', () => {
    const chunks = chunkRepoFile('docs/guide.md', MD_SAMPLE)
    expect(chunks.map((chunk) => [chunk.symbol, chunk.kind])).toEqual([
      ['Top heading', 'markdown'],
      ['Setup steps', 'markdown'],
      ['Usage', 'markdown']
    ])
    const usage = chunks[2]
    expect(usage.lineStart).toBe(9)
    expect(usage.lineEnd).toBe(11)
    expect(usage.content).toBe('## Usage\n\nCall the CLI.')
  })

  it('indexes a JSON file as one whole-file chunk', () => {
    const content = '{\n  "name": "atlas",\n  "count": 2\n}'
    const chunks = chunkRepoFile('config/atlas.json', content)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({ kind: 'json', symbol: '', lineStart: 1, lineEnd: 4 })
    expect(chunks[0].content).toBe(content)
  })

  it('falls back to sliding 64-line windows with 8-line overlap for declaration-less code', () => {
    const lines = Array.from({ length: 70 }, (_, index) => `results.push(compute(${index}))`)
    const chunks = chunkRepoFile('scripts/flat.ts', lines.join('\n'))
    expect(chunks.map((chunk) => [chunk.lineStart, chunk.lineEnd])).toEqual([
      [1, 64],
      [57, 70]
    ])
    expect(chunks[0].symbol).toBe('')
    // Windows 2..64 and 57..70 overlap by exactly 8 lines.
    expect(chunks[1].content.split('\n')).toHaveLength(14)
  })

  it('returns no chunks for empty content and windows for non-code files', () => {
    expect(chunkRepoFile('empty.ts', '   \n')).toEqual([])
    const textChunks = chunkRepoFile(
      'notes/plan.txt',
      Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n')
    )
    expect(textChunks).toHaveLength(1)
    expect(textChunks[0].kind).toBe('text')
  })
})

describe('extractSymbols', () => {
  it('records code declarations with kinds, line ranges and signatures', () => {
    const symbols = extractSymbols('src/atlas-sample.ts', TS_SAMPLE)
    expect(symbols.map((symbol) => [symbol.name, symbol.kind])).toEqual([
      ['atlasGreet', 'function'],
      ['AtlasIndex', 'class'],
      ['AtlasOptions', 'interface'],
      ['AtlasMode', 'type'],
      ['DEFAULT_MODE', 'const']
    ])
    expect(symbols[1].lineStart).toBe(8)
    expect(symbols[1].lineEnd).toBe(15)
    expect(symbols[0].signature).toBe('export function atlasGreet(name: string): string {')
  })

  it('records markdown headings and nothing for json', () => {
    expect(extractSymbols('docs/guide.md', MD_SAMPLE).map((symbol) => symbol.name)).toEqual([
      'Top heading',
      'Setup steps',
      'Usage'
    ])
    expect(extractSymbols('config/atlas.json', '{}')).toEqual([])
  })
})

describe('extractImports + resolveImportSpec', () => {
  it('extracts static, type, export-from, require and dynamic imports deduped', () => {
    const content = [
      "import { runProcess } from '@shield/process-host'",
      "import type { Chunk } from './atlas-chunker'",
      "export * from './atlas-embedder'",
      "const pg = require('pg')",
      "void import('./lazy')",
      "import { runProcess } from '@shield/process-host'"
    ].join('\n')
    expect(extractImports(content)).toEqual([
      '@shield/process-host',
      './atlas-chunker',
      './atlas-embedder',
      'pg',
      './lazy'
    ])
  })

  it('resolves relative specs with extension candidates and workspace imports', () => {
    const files = new Set([
      'src/packages/neuro/src/atlas-chunker.ts',
      'src/packages/process-host/src/index.ts',
      'src/packages/neuro/src/lazy/index.js'
    ])
    const exists = (repoPath: string) => files.has(repoPath)
    expect(
      resolveImportSpec('src/packages/neuro/src/atlas-indexer.ts', './atlas-chunker', exists)
    ).toBe('src/packages/neuro/src/atlas-chunker.ts')
    expect(resolveImportSpec('src/packages/neuro/src/x.ts', './lazy', exists)).toBe(
      'src/packages/neuro/src/lazy/index.js'
    )
    expect(resolveImportSpec('src/packages/neuro/src/x.ts', '@shield/process-host', exists)).toBe(
      'src/packages/process-host/src/index.ts'
    )
    expect(resolveImportSpec('src/packages/neuro/src/x.ts', 'pg', exists)).toBeNull()
    expect(resolveImportSpec('src/packages/neuro/src/x.ts', './missing', exists)).toBeNull()
  })
})
