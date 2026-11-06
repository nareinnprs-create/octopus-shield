import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ArmoryCategory,
  ArmoryRuntime,
  ArmoryToolDescriptor,
  ArmoryScopeClass
} from './tool-registry'

/** Shape written by the install ring agents (armory/<ring>.json) and by discovery (discovered.json). */
export type ArmoryInventoryEntry = {
  id: string
  runtime: ArmoryRuntime
  binPath?: string
  exePath?: string
  image?: string
  winInvoke?: string
  /** Docker-only full argv override (entrypoint quirks, bundle-exec modes). */
  dockerFullArgv?: readonly string[]
  version?: string
  status: 'ok' | 'failed' | 'quarantined-by-av' | 'skipped' | 'not-discovered'
  error?: string
  notes?: string
  /** Shipped-catalog marker: descriptor is a placeholder until armory discovery resolves a live path. */
  requiresDiscovery?: boolean
}

const CATEGORY_BY_ID: Record<string, ArmoryCategory> = {
  nmap: 'recon',
  masscan: 'recon',
  amass: 'recon',
  whois: 'recon',
  'bloodhound-py': 'recon',
  'bloodhound-ce': 'recon',
  metasploit: 'exploitation',
  msfvenom: 'exploitation',
  searchsploit: 'exploitation',
  mimikatz: 'post-exploitation',
  pypykatz: 'post-exploitation',
  netexec: 'post-exploitation',
  impacket: 'post-exploitation',
  'burp-suite': 'web',
  sqlmap: 'web',
  ffuf: 'web',
  nikto: 'web',
  whatweb: 'web',
  nuclei: 'web',
  httpx: 'recon',
  subfinder: 'recon',
  hashcat: 'cracking',
  hydra: 'cracking',
  responder: 'mitm',
  bettercap: 'mitm',
  tshark: 'forensics',
  'wireshark-tshark': 'forensics',
  tcpdump: 'forensics',
  ghidra: 'forensics',
  aircrack: 'wireless'
}

const SCOPE_CLASS_BY_CATEGORY: Record<ArmoryCategory, ArmoryScopeClass> = {
  recon: 'recon',
  exploitation: 'exploitation',
  'post-exploitation': 'post-exploitation',
  web: 'web',
  cracking: 'cracking',
  wireless: 'wireless',
  mitm: 'mitm',
  forensics: 'forensics'
}

const VERSION_ARGS: Record<string, readonly string[]> = {
  nmap: ['--version'],
  // TODO(verify): nikto's usage documents `nikto -Version` (capital V).
  nikto: ['-Version'],
  whatweb: ['--version'],
  whois: ['--version'],
  masscan: ['--version'],
  amass: ['-version'],
  impacket: ['--help'],
  netexec: ['--version'],
  responder: ['--help'],
  sqlmap: ['--version'],
  hydra: ['-h'],
  ffuf: ['-V'],
  // TODO(verify): each against tool docs (projectdiscovery/nuclei, httpx, subfinder).
  nuclei: ['-version'],
  httpx: ['-version'],
  subfinder: ['-version'],
  'bloodhound-py': ['--help'],
  'bloodhound-ce': ['--help'],
  metasploit: ['--version'],
  msfvenom: ['--version'],
  searchsploit: ['--help'],
  mimikatz: ['--version'],
  pypykatz: ['--help'],
  'burp-suite': ['--version'],
  bettercap: ['-version'],
  'wireshark-tshark': ['--version'],
  tcpdump: ['--version'],
  ghidra: ['--help'],
  aircrack: ['--help']
}

const targetFor = (entry: ArmoryInventoryEntry): string =>
  entry.image ?? entry.binPath ?? entry.exePath ?? entry.winInvoke ?? ''

/** userData roots for inventory resolution; OSHIELD_USER_DATA_PATH is the repo-wide profile override. */
export type ArmoryInventoryOptions = {
  /** Explicit app-context userData dir (electron app.getPath('userData')); wins over generic env. */
  userDataPath?: string
  env?: Readonly<Record<string, string | undefined>>
}

export const DISCOVERED_FILE = 'discovered.json'

const firstDefined = (values: readonly (string | undefined)[]): string | undefined =>
  values.find((value) => value !== undefined && value.length > 0)

export const userDataRoot = (options: ArmoryInventoryOptions = {}): string | undefined =>
  firstDefined([
    options.userDataPath,
    options.env?.OSHIELD_USER_DATA_PATH,
    options.env?.OSHIELD_APP_USERDATA
  ])

/**
 * Inventory dir: the OSHIELD_ARMORY_INVENTORY override wins; else the resolved
 * userData root + armory/inventory. Callers without any root (bare CLI, tests)
 * get a relative placeholder that live in loadToolInventory's missing-ring
 * tolerance instead of a dev-machine hardcode.
 */
export const armoryInventoryDir = (options: ArmoryInventoryOptions = {}): string => {
  // Bare calls (CLI, tests) still honor process.env; app-context calls pass env explicitly.
  const env = options.env ?? process.env
  const override = firstDefined([env.OSHIELD_ARMORY_INVENTORY])
  if (override !== undefined) {
    return override
  }
  return join(userDataRoot({ ...options, env }) ?? '', 'armory', 'inventory')
}

export const defaultInventoryPaths = (options: ArmoryInventoryOptions = {}): string[] =>
  ['windows.json', 'wsl.json', 'docker.json', 'extra.json', DISCOVERED_FILE].map((name) =>
    join(armoryInventoryDir(options), name)
  )

/** Load order: user/userData rings + discovery output first, shipped extraResources rings last (first per id wins). */
export const toolInventoryLoadPaths = (
  options: ArmoryInventoryOptions & {
    shippedInventoryDir?: string
  }
): string[] => {
  const paths = defaultInventoryPaths(options)
  if (options.shippedInventoryDir === undefined) {
    return paths
  }
  return [
    ...paths,
    ...['windows.json', 'wsl.json', 'docker.json', 'extra.json'].map((name) =>
      join(options.shippedInventoryDir ?? '', name)
    )
  ]
}

/** A missing ring must not blind the whole armory; the first ring wins per tool id. */
export const loadToolInventory = (paths: readonly string[]): ArmoryToolDescriptor[] => {
  const rings: ArmoryInventoryEntry[][] = []
  for (const path of paths) {
    try {
      rings.push(JSON.parse(readFileSync(path, 'utf8')))
    } catch {
      // Keep the remaining rings loadable.
    }
  }
  const seen = new Set<string>()
  return descriptorsFromInventories(rings).filter((tool) => {
    if (seen.has(tool.id)) {
      return false
    }
    seen.add(tool.id)
    return true
  })
}

/** Merges ring inventories into run-ready descriptors; failed entries are kept (runner refuses them). */
export const descriptorsFromInventories = (
  inventories: readonly ArmoryInventoryEntry[][]
): ArmoryToolDescriptor[] => {
  const out: ArmoryToolDescriptor[] = []
  for (const inventory of inventories) {
    for (const entry of inventory) {
      const category = CATEGORY_BY_ID[entry.id]
      if (category === undefined) {
        continue
      }
      const target = targetFor(entry)
      // Shipped-catalog placeholders stay visible so the UI shows setup state; the runner denies them.
      if (target.length === 0 && entry.status !== 'not-discovered') {
        continue
      }
      out.push({
        id: entry.id,
        title: entry.id,
        category,
        runtime: entry.runtime,
        target,
        versionArgv: VERSION_ARGS[entry.id] ?? ['--version'],
        scopeClass: SCOPE_CLASS_BY_CATEGORY[category],
        status: entry.status,
        ...(entry.dockerFullArgv === undefined ? {} : { dockerFullArgv: entry.dockerFullArgv })
      })
    }
  }
  return out
}
