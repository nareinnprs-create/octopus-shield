import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  defaultInventoryPaths,
  descriptorsFromInventories,
  loadToolInventory,
  type ArmoryInventoryEntry
} from './inventory'

const entry = (overrides: Partial<ArmoryInventoryEntry>): ArmoryInventoryEntry => ({
  id: 'nmap',
  runtime: 'docker',
  status: 'ok',
  ...overrides
})

describe('descriptorsFromInventories', () => {
  it('maps ring entries to run-ready descriptors with category, scope class, and version args', () => {
    const [nmap] = descriptorsFromInventories([
      [entry({ id: 'nmap', runtime: 'docker', image: 'nmap:latest' })]
    ])
    expect(nmap).toEqual({
      id: 'nmap',
      title: 'nmap',
      category: 'recon',
      runtime: 'docker',
      target: 'nmap:latest',
      versionArgv: ['--version'],
      scopeClass: 'recon',
      status: 'ok'
    })
  })

  it('uses exePath as the win runtime target', () => {
    const [tshark] = descriptorsFromInventories([
      [entry({ id: 'wireshark-tshark', runtime: 'win', exePath: 'C:\\tools\\tshark.exe' })]
    ])
    expect(tshark?.target).toBe('C:\\tools\\tshark.exe')
    expect(tshark?.runtime).toBe('win')
    expect(tshark?.category).toBe('forensics')
    expect(tshark?.scopeClass).toBe('forensics')
  })

  it('target precedence is image > binPath > exePath > winInvoke', () => {
    const [both, binOverExe, invoked] = descriptorsFromInventories([
      [entry({ image: 'nmap:latest', binPath: '/usr/bin/nmap', exePath: 'C:\\nmap.exe', winInvoke: 'nmap.exe' })],
      [entry({ binPath: '/usr/bin/sqlmap', exePath: 'C:\\sqlmap.exe', winInvoke: 'sqlmap.exe', id: 'sqlmap' })],
      [entry({ id: 'netexec', runtime: 'win', winInvoke: 'nxc.cmd' })]
    ])
    expect(both?.target).toBe('nmap:latest')
    expect(binOverExe?.target).toBe('/usr/bin/sqlmap')
    expect(invoked?.target).toBe('nxc.cmd')
  })

  it('maps the documented version args (incl. non-standard ones)', () => {
    const [amass, ffuf, tshark] = descriptorsFromInventories([
      [
        entry({ id: 'amass', image: 'amass:latest' }),
        entry({ id: 'ffuf', image: 'ffuf:latest' }),
        entry({ id: 'tshark', runtime: 'wsl', binPath: '/usr/bin/tshark' })
      ]
    ])
    expect(amass?.versionArgv).toEqual(['-version'])
    expect(ffuf?.versionArgv).toEqual(['-V'])
    expect(tshark?.versionArgv).toEqual(['--version'])
  })

  it('skips unknown tool ids', () => {
    const descriptors = descriptorsFromInventories([
      [entry({ id: 'totally-unknown-tool', image: 'x:latest' }), entry({ id: 'masscan', image: 'masscan:latest' })]
    ])
    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(['masscan'])
  })

  it('skips known ids that carry no usable target', () => {
    const descriptors = descriptorsFromInventories([[entry({ id: 'nmap', runtime: 'docker' })]])
    expect(descriptors).toEqual([])
  })

  it('keeps failed entries so the runner can refuse them explicitly', () => {
    const [failed] = descriptorsFromInventories([
      [entry({ id: 'hydra', runtime: 'wsl', binPath: '/usr/bin/hydra', status: 'failed', error: 'build failed' })]
    ])
    expect(failed?.status).toBe('failed')
    expect(failed?.scopeClass).toBe('cracking')
  })

  it('merges multiple ring inventories in order', () => {
    const descriptors = descriptorsFromInventories([
      [entry({ id: 'nmap', image: 'nmap:ring1' })],
      [entry({ id: 'aircrack', runtime: 'wsl', binPath: '/usr/bin/aircrack-ng' })]
    ])
    expect(descriptors.map((descriptor) => descriptor.id)).toEqual(['nmap', 'aircrack'])
    expect(descriptors[1]?.category).toBe('wireless')
  })
})

describe('inventory loading', () => {
  const tempRoots: string[] = []

  const tempInventoryDir = (): string => {
    const root = mkdtempSync(join(tmpdir(), 'armory-inventory-'))
    tempRoots.push(root)
    return root
  }

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('loads ring files and skips missing rings without losing the rest', () => {
    const dir = tempInventoryDir()
    const wslRing = join(dir, 'wsl.json')
    writeFileSync(wslRing, JSON.stringify([entry({ id: 'nmap', runtime: 'wsl', binPath: '/usr/bin/nmap' })]))

    const tools = loadToolInventory([wslRing, join(dir, 'missing.json')])
    expect(tools.map((tool) => tool.id)).toEqual(['nmap'])
  })

  it('first ring wins when two rings define the same tool id', () => {
    const dir = tempInventoryDir()
    const first = join(dir, 'first.json')
    const second = join(dir, 'second.json')
    writeFileSync(first, JSON.stringify([entry({ id: 'nmap', image: 'nmap:first' })]))
    writeFileSync(second, JSON.stringify([entry({ id: 'nmap', image: 'nmap:second' })]))

    const tools = loadToolInventory([first, second])
    expect(tools).toHaveLength(1)
    expect(tools[0]?.target).toBe('nmap:first')
  })

  it('defaultInventoryPaths covers the four ring files under the inventory dir', () => {
    process.env.OSHIELD_ARMORY_INVENTORY = tempInventoryDir()
    const paths = defaultInventoryPaths()
    expect(paths.map((path) => path.split(/[\\/]/).at(-1))).toEqual([
      'windows.json',
      'wsl.json',
      'docker.json',
      'extra.json'
    ])
    for (const path of paths) {
      expect(path.startsWith(process.env.OSHIELD_ARMORY_INVENTORY)).toBe(true)
    }
  })
})
