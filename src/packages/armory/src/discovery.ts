/**
 * Armory tool discovery: pure path probing (spawnSync `--version`), never
 * auto-install. Output feeds userData armory/inventory/discovered.json which
 * loadToolInventory merges with the shipped rings (first per tool id wins).
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  armoryInventoryDir,
  DISCOVERED_FILE,
  type ArmoryInventoryEntry,
  type ArmoryInventoryOptions
} from './inventory'
import type { ArmoryRuntime } from './tool-registry'

export type DiscoveredTool = {
  id: string
  runtime: ArmoryRuntime
  /** Resolved program (absolute path for well-known finds, bare name for PATH finds). */
  target: string
  version: string | null
  source: 'path' | 'well-known'
}

export const DISCOVERY_TOOL_IDS = [
  'nmap',
  'hydra',
  'sqlmap',
  'nikto',
  'ffuf',
  'whatweb',
  'whois'
] as const

export type DiscoveryToolId = (typeof DISCOVERY_TOOL_IDS)[number]

const PROBE_ARGV: Record<DiscoveryToolId, readonly string[]> = {
  nmap: ['--version'],
  // TODO(verify): nikto's usage documents `nikto -Version` (capital V).
  nikto: ['-Version'],
  whatweb: ['--version'],
  whois: ['--version'],
  hydra: ['-h'],
  sqlmap: ['--version'],
  ffuf: ['-V']
}

/**
 * Windows exe names. whois/nikto/whatweb/sqlmap have no stable exe name across
 * Windows installs (perl/python frontends, Sysinternals variants) — those stay
 * PATH-only by design instead of inventing install paths. TODO(verify): revisit
 * against actual installer docs if a "not discovered" report shows up for them.
 */
const WINDOWS_EXE_IDS = new Set<DiscoveryToolId>(['nmap', 'hydra', 'ffuf'])

/**
 * Well-known install dirs verified per tool — empty lists mean PATH-only by
 * design (no invented install locations). TODO(verify) marks the estimates.
 */
const WELL_KNOWN_DIRS: Partial<
  Record<DiscoveryToolId, { win?: string[]; linux?: string[]; darwin?: string[] }>
> = {
  nmap: {
    // Official Nmap Windows installer default (documented at nmap.org/download).
    win: [join('C:', 'Program Files', 'Nmap')]
  }
}

/** Executable candidates for one tool on one platform; PATH is probed separately via `pathProbe`. */
export const toolCandidates = (
  id: DiscoveryToolId,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env
): { pathProbe: string; knownFiles: string[] } => {
  const osKey = platform === 'win32' ? 'win' : platform === 'darwin' ? 'darwin' : 'linux'
  const wellKnownDirs = WELL_KNOWN_DIRS[id]?.[osKey] ?? []
  if (platform === 'win32') {
    const files = windowsFileNames(id).flatMap((name) =>
      wellKnownDirs.map((dir) => join(dir, name))
    )
    if (id === 'ffuf' && env.USERPROFILE) {
      // Documented `go install github.com/ffuf/ffuf@latest` output: go default GOPATH bin. TODO(verify).
      files.push(join(env.USERPROFILE, 'go', 'bin', 'ffuf.exe'))
    }
    return { pathProbe: id, knownFiles: [...new Set(files)] }
  }
  return {
    pathProbe: id,
    knownFiles: [
      ...new Set([...wellKnownDirs, ...platformDirs(platform)].map((dir) => join(dir, id)))
    ]
  }
}

const windowsFileNames = (id: DiscoveryToolId): string[] =>
  WINDOWS_EXE_IDS.has(id) ? [`${id}.exe`] : []

/** Standard Unix bin dirs (HOME-relative go bin handled separately for ffuf). */
const platformDirs = (platform: NodeJS.Platform): string[] =>
  platform === 'darwin'
    ? [join('/', 'usr', 'local', 'bin'), join('/', 'opt', 'homebrew', 'bin')]
    : [join('/', 'usr', 'bin'), join('/', 'usr', 'local', 'bin')]

const firstMeaningfulLine = (output: string): string | null => {
  const line = output.split('\n')[0]?.trim()
  return line === undefined || line.length === 0 ? null : line
}

type ProbeResult = { status: number | null; stdout: string; stderr: string }

const runProbe = (
  program: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv
): ProbeResult => {
  try {
    const run = spawnSync(program, [...args], {
      encoding: 'utf8' as const,
      timeout: 4_000,
      windowsHide: true,
      shell: false,
      env: { ...env }
    })
    return {
      status: run.status,
      stdout: typeof run.stdout === 'string' ? run.stdout : '',
      stderr: typeof run.stderr === 'string' ? run.stderr : ''
    }
  } catch {
    return { status: null, stdout: '', stderr: '' }
  }
}

const probeFound = (run: ProbeResult): string | null =>
  // Exit code 0 or any printed line counts; a usable version/help line is enough.
  firstMeaningfulLine(run.stdout) ?? firstMeaningfulLine(run.stderr)

const runtimeFor = (platform: NodeJS.Platform): ArmoryRuntime =>
  platform === 'win32' ? 'win' : 'native'

/** One tool: PATH probe first, then existing well-known files. Only version-style probes ever spawn. */
export const discoverTool = (
  id: DiscoveryToolId,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): DiscoveredTool | null => {
  const argv = PROBE_ARGV[id]
  const { pathProbe, knownFiles } = toolCandidates(id, platform, env)
  const pathRun = probeFound(runProbe(pathProbe, argv, env))
  if (pathRun !== null) {
    return {
      id,
      runtime: runtimeFor(platform),
      target: pathProbe,
      version: pathRun,
      source: 'path'
    }
  }
  for (const file of knownFiles) {
    if (!existsSync(file)) {
      continue
    }
    const run = probeFound(runProbe(file, argv, env))
    if (run !== null) {
      return { id, runtime: runtimeFor(platform), target: file, version: run, source: 'well-known' }
    }
  }
  return null
}

/**
 * Discovers the probe tools on this device. A fresh device (nothing installed)
 * stays cheap: each missing tool is one fast ENOENT spawn. Never auto-installs.
 */
export const discoverTools = async (
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<DiscoveredTool[]> =>
  DISCOVERY_TOOL_IDS.flatMap((id) => {
    const found = discoverTool(id, platform, env)
    return found ? [found] : []
  })

/** discovered.json entries merge straight into the ring pipeline. */
export const toInventoryEntries = (tools: readonly DiscoveredTool[]): ArmoryInventoryEntry[] =>
  tools.map((tool) => ({
    id: tool.id,
    runtime: tool.runtime,
    ...(isWindowsOrNativeFile(tool) ? { exePath: tool.target } : { binPath: tool.target }),
    ...(tool.version === null ? {} : { version: tool.version }),
    status: 'ok',
    notes: `discovered (${tool.source})`
  }))

// Win entries carry exePath; macOS/Linux absolute finds are file paths and native command finds are bare names.
const isWindowsOrNativeFile = (tool: DiscoveredTool): boolean =>
  tool.source === 'path' ? false : isAbsolute(tool.target)

export const discoveredFilePath = (options: ArmoryInventoryOptions = {}): string =>
  join(armoryInventoryDir(options), DISCOVERED_FILE)

const readEntries = (file: string): ArmoryInventoryEntry[] => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return Array.isArray(parsed) ? (parsed as ArmoryInventoryEntry[]) : []
  } catch {
    return []
  }
}

/**
 * Writes/merges discovered.json idempotently: existing ids keep their rows
 * (rings ahead of discovery win), new ids append, nothing is ever deleted.
 */
export const writeDiscoveredInventory = (
  options: ArmoryInventoryOptions,
  tools: readonly DiscoveredTool[]
): string | null => {
  const file = discoveredFilePath(options)
  try {
    mkdirSync(armoryInventoryDir(options), { recursive: true })
    const existing = readEntries(file)
    const have = new Set(existing.map((entry) => entry.id))
    const additions = toInventoryEntries(tools).filter((entry) => !have.has(entry.id))
    writeFileSync(file, `${JSON.stringify([...existing, ...additions], null, 2)}\n`)
    return file
  } catch {
    return null
  }
}
