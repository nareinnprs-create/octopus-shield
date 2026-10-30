import { createHash } from 'node:crypto'

/**
 * Language-aware repo chunker WITHOUT tree-sitter (no native dep).
 * TS-family files split on column-0 declarations with a bracket/depth scan,
 * markdown splits on headings, JSON indexes whole-file, everything else
 * falls back to sliding line windows. Pure string-in/string-out so it is
 * fully unit-testable; the indexer owns all filesystem access.
 */

export type ChunkKind = 'code' | 'markdown' | 'json' | 'text'

/** File-level chunks carry symbol = '' (see neuro_chunks.symbol in infra/db/neuro.sql). */
export type Chunk = {
  path: string
  symbol: string
  kind: ChunkKind
  content: string
  sha256: string
  lineStart: number
  lineEnd: number
}

export type SymbolRecord = {
  name: string
  kind: string
  lineStart: number
  lineEnd: number
  signature: string
}

const WINDOW_LINES = 64
const WINDOW_OVERLAP_LINES = 8
const MAX_SIGNATURE_CHARS = 200
const MAX_HEADING_CHARS = 80

const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown'])
const INDEXABLE_EXTENSIONS = [...CODE_EXTENSIONS, ...MARKDOWN_EXTENSIONS, '.json']

export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/** Column-0 declarations only; indented members belong to their parent chunk. */
const DECLARATION_RE =
  /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?(?:async\s+)?(function\*?|class|interface|enum|type|const|let|var)\s+([A-Za-z_$][\w$]*)/

const KIND_BY_KEYWORD: Record<string, string> = {
  function: 'function',
  class: 'class',
  interface: 'interface',
  enum: 'enum',
  type: 'type',
  const: 'const',
  let: 'const',
  var: 'const'
}

type CodeRegion = {
  name: string
  kind: string
  lineStart: number
  lineEnd: number
  signature: string
}

/**
 * End-of-region scan: tracks one combined depth over (), [], {} while
 * skipping strings, template literals and comments. Region ends when depth
 * returns to zero after any open, or (nothing ever opened) at a ';' line or
 * blank line. shortcut: regex literals with unbalanced brackets and nested
 * template literals skew the end; upgrade to tree-sitter when precision
 * matters more than the zero-native-dep constraint.
 */
function regionEndLine(lines: string[], start: number): number {
  let depth = 0
  let opened = false
  let mode: 'code' | 'line-comment' | 'block-comment' | 'single' | 'double' | 'template' = 'code'
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]
    let lastCodeChar = ''
    for (let j = 0; j < line.length; j += 1) {
      const ch = line[j]
      const next = j + 1 < line.length ? line[j + 1] : ''
      if (mode === 'code') {
        if (ch === '/' && next === '/') {
          break
        }
        if (ch === '/' && next === '*') {
          mode = 'block-comment'
          j += 1
        } else if (ch === "'") {
          mode = 'single'
        } else if (ch === '"') {
          mode = 'double'
        } else if (ch === '`') {
          mode = 'template'
        } else if (ch === '(' || ch === '[' || ch === '{') {
          depth += 1
          opened = true
        } else if (ch === ')' || ch === ']' || ch === '}') {
          depth = Math.max(0, depth - 1)
        } else if (!/\s/.test(ch)) {
          lastCodeChar = ch
        }
      } else if (mode === 'block-comment') {
        if (ch === '*' && next === '/') {
          mode = 'code'
          j += 1
        }
      } else if (mode === 'single') {
        if (ch === '\\') {
          j += 1
        } else if (ch === "'") {
          mode = 'code'
        }
      } else if (mode === 'double') {
        if (ch === '\\') {
          j += 1
        } else if (ch === '"') {
          mode = 'code'
        }
      } else if (ch === '\\') {
        j += 1
      } else if (ch === '`') {
        mode = 'code'
      }
    }
    if (opened) {
      if (depth === 0) {
        return i + 1
      }
    } else if (lastCodeChar === ';' || line.trim() === '') {
      return i + 1
    }
  }
  return lines.length
}

function scanCodeRegions(content: string): CodeRegion[] {
  const lines = content.split('\n')
  const regions: CodeRegion[] = []
  let i = 0
  while (i < lines.length) {
    const match = DECLARATION_RE.exec(lines[i])
    if (!match) {
      i += 1
      continue
    }
    const lineEnd = regionEndLine(lines, i)
    regions.push({
      name: match[2],
      kind: KIND_BY_KEYWORD[match[1].replace(/\*$/, '')] ?? 'const',
      lineStart: i + 1,
      lineEnd,
      signature: lines[i].trim().slice(0, MAX_SIGNATURE_CHARS)
    })
    i = lineEnd
  }
  return regions
}

function windows(lines: string[]): { lineStart: number; lineEnd: number }[] {
  const out: { lineStart: number; lineEnd: number }[] = []
  const step = WINDOW_LINES - WINDOW_OVERLAP_LINES
  for (let start = 0; start < lines.length; start += step) {
    out.push({ lineStart: start + 1, lineEnd: Math.min(start + WINDOW_LINES, lines.length) })
    if (start + WINDOW_LINES >= lines.length) {
      break
    }
  }
  return out
}

function makeChunk(
  path: string,
  kind: ChunkKind,
  symbol: string,
  lines: string[],
  lineStart: number,
  lineEnd: number
): Chunk {
  // Trailing blank lines (file-final newline) belong to no chunk.
  let end = lineEnd
  while (end > lineStart && lines[end - 1].trim() === '') {
    end -= 1
  }
  const content = lines.slice(lineStart - 1, end).join('\n')
  return { path, symbol, kind, content, sha256: sha256Hex(content), lineStart, lineEnd: end }
}

function chunkMarkdown(path: string, content: string): Chunk[] {
  const lines = content.split('\n')
  if (lines.every((line) => line.trim() === '')) {
    return []
  }
  const headingIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^#{1,6}\s+\S/.test(line))
    .map(({ index }) => index)
  if (headingIndexes.length === 0) {
    return [makeChunk(path, 'markdown', '', lines, 1, lines.length)]
  }
  const chunks: Chunk[] = []
  if (
    headingIndexes[0] > 0 &&
    lines.slice(0, headingIndexes[0]).some((line) => line.trim() !== '')
  ) {
    chunks.push(makeChunk(path, 'markdown', '', lines, 1, headingIndexes[0]))
  }
  headingIndexes.forEach((headingIndex, position) => {
    const sectionEnd =
      position + 1 < headingIndexes.length ? headingIndexes[position + 1] : lines.length
    const heading = lines[headingIndex]
      .replace(/^#{1,6}\s+/, '')
      .trim()
      .slice(0, MAX_HEADING_CHARS)
    chunks.push(makeChunk(path, 'markdown', heading, lines, headingIndex + 1, sectionEnd))
  })
  return chunks
}

function chunkCode(path: string, content: string): Chunk[] {
  const lines = content.split('\n')
  if (lines.every((line) => line.trim() === '')) {
    return []
  }
  const regions = scanCodeRegions(content)
  if (regions.length === 0) {
    return windows(lines).map((span) =>
      makeChunk(path, 'code', '', lines, span.lineStart, span.lineEnd)
    )
  }
  const chunks = regions.map((region) =>
    makeChunk(path, 'code', region.name, lines, region.lineStart, region.lineEnd)
  )
  const preludeEnd = regions[0].lineStart - 1
  if (preludeEnd > 0 && lines.slice(0, preludeEnd).some((line) => line.trim() !== '')) {
    chunks.unshift(makeChunk(path, 'code', '', lines, 1, preludeEnd))
  }
  return chunks
}

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

export function isIndexablePath(path: string): boolean {
  return INDEXABLE_EXTENSIONS.includes(extensionOf(path))
}

/** Entry point: repo-relative POSIX path + file content → chunks. */
export function chunkRepoFile(path: string, content: string): Chunk[] {
  const extension = extensionOf(path)
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return chunkMarkdown(path, content)
  }
  if (extension === '.json') {
    const lines = content.split('\n')
    if (lines.every((line) => line.trim() === '')) {
      return []
    }
    return [makeChunk(path, 'json', '', lines, 1, lines.length)]
  }
  if (CODE_EXTENSIONS.has(extension)) {
    return chunkCode(path, content)
  }
  const lines = content.split('\n')
  if (lines.every((line) => line.trim() === '')) {
    return []
  }
  return windows(lines).map((span) =>
    makeChunk(path, 'text', '', lines, span.lineStart, span.lineEnd)
  )
}

/** Symbols for neuro_symbols: code declarations, markdown headings; json/text have none. */
export function extractSymbols(path: string, content: string): SymbolRecord[] {
  const extension = extensionOf(path)
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    const lines = content.split('\n')
    const headingIndexes = lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => /^#{1,6}\s+\S/.test(line))
      .map(({ index }) => index)
    return headingIndexes.map((headingIndex, position) => {
      const sectionEnd =
        position + 1 < headingIndexes.length ? headingIndexes[position + 1] : lines.length
      return {
        name: lines[headingIndex]
          .replace(/^#{1,6}\s+/, '')
          .trim()
          .slice(0, MAX_HEADING_CHARS),
        kind: 'heading',
        lineStart: headingIndex + 1,
        lineEnd: sectionEnd,
        signature: lines[headingIndex].trim().slice(0, MAX_SIGNATURE_CHARS)
      }
    })
  }
  if (!CODE_EXTENSIONS.has(extension)) {
    return []
  }
  return scanCodeRegions(content).map((region) => ({
    name: region.name,
    kind: region.kind,
    lineStart: region.lineStart,
    lineEnd: region.lineEnd,
    signature: region.signature
  }))
}
