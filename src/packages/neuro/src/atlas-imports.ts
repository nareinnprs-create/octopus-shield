/**
 * Import extraction and resolution for neuro_links edges: regex import/require
 * statement scan (see infra/db/neuro.sql — only RESOLVED edges are stored),
 * spec → repo-relative POSIX path, or null when external/unresolvable.
 */

const IMPORT_PATTERNS = [
  /(?:^|[^\w$.])import\s+(?:type\s+)?(?:[\w$*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
  /(?:^|[^\w$.])export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
]

/** Static + dynamic import specs in first-seen order, deduped. */
export function extractImports(content: string): string[] {
  const specs: string[] = []
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0
    for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
      if (!specs.includes(match[1])) {
        specs.push(match[1])
      }
    }
  }
  return specs
}

function posixDirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

function posixNormalize(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      out.pop()
    } else {
      out.push(part)
    }
  }
  return out.join('/')
}

const RELATIVE_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '/index.ts',
  '/index.tsx',
  '/index.js'
]

/**
 * Resolves a spec to a repo-relative POSIX path, or null when external or
 * unresolvable. `exists` receives repo-relative candidates (indexer injects
 * fs). `@shield/*` workspace imports map to their package source entry.
 */
export function resolveImportSpec(
  fromPath: string,
  spec: string,
  exists: (repoPath: string) => boolean
): string | null {
  const candidates: string[] = []
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = posixNormalize(posixDirname(fromPath) ? `${posixDirname(fromPath)}/${spec}` : spec)
    for (const suffix of RELATIVE_SUFFIXES) {
      candidates.push(`${base}${suffix}`)
    }
  } else if (spec.startsWith('@shield/')) {
    const pkg = spec.slice('@shield/'.length).split('/')[0]
    candidates.push(`src/packages/${pkg}/src/index.ts`)
  } else {
    return null
  }
  return candidates.find((candidate) => candidate.length > 0 && exists(candidate)) ?? null
}
