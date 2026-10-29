import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ArmoryCategory, ArmoryRuntime, ArmoryToolDescriptor, ArmoryScopeClass } from './tool-registry'

/** Shape written by the install ring agents (armory/<ring>.json). */
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
  status: 'ok' | 'failed' | 'quarantined-by-av' | 'skipped'
  error?: string
  notes?: string
}

const CATEGORY_BY_ID: Record<string, ArmoryCategory> = {
  nmap: 'recon',
  masscan: 'recon',
  amass: 'recon',
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
  masscan: ['--version'],
  amass: ['-version'],
  impacket: ['--help'],
  netexec: ['--version'],
  responder: ['--help'],
  sqlmap: ['--version'],
  hydra: ['-h'],
  ffuf: ['-V'],
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

/** Canonical machine-local inventory dir; temp fallback keeps dev-box parity. */
export const armoryInventoryDir = (): string =>
  process.env.OSHIELD_ARMORY_INVENTORY ?? 'C:\\Users\\manag\\tools\\armory\\inventory'

export const defaultInventoryPaths = (): string[] =>
  ['windows.json', 'wsl.json', 'docker.json', 'extra.json'].map((name) =>
    join(armoryInventoryDir(), name)
  )

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
      if (target.length === 0) {
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
