import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { toolCandidates, discoverTool, toInventoryEntries, DISCOVERY_TOOL_IDS } from './discovery'

describe('toolCandidates', () => {
  it('probes nmap on PATH and the documented Windows installer dir, never an invented path', () => {
    const { pathProbe, knownFiles } = toolCandidates('nmap', 'win32')
    expect(pathProbe).toBe('nmap')
    expect(knownFiles).toEqual([join('C:', 'Program Files', 'Nmap', 'nmap.exe')])
  })

  it('keeps perl/python-frontend tools PATH-only on Windows by design', () => {
    const { knownFiles } = toolCandidates('sqlmap', 'win32')
    expect(knownFiles).toEqual([])
  })

  it('adds the documented go-install ffuf location under USERPROFILE', () => {
    const { knownFiles } = toolCandidates('ffuf', 'win32', { USERPROFILE: 'C:\\Users\\t' })
    expect(knownFiles).toContain(join('C:', 'Users', 't', 'go', 'bin', 'ffuf.exe'))
  })
})

describe('discoverTool', () => {
  it('missing probes never throw; a linux-platform probe with empty PATH finds nothing', () => {
    expect(discoverTool('nmap', 'linux', { PATH: '' })).toBeNull()
  })
})

describe('toInventoryEntries', () => {
  it('maps PATH finds to bare-name targets with ok status', () => {
    const [entry] = toInventoryEntries([
      { id: 'nmap', runtime: 'win', target: 'nmap', version: 'Nmap 7.80', source: 'path' }
    ])
    expect(entry.status).toBe('ok')
    expect(entry.binPath).toBe('nmap')
    expect(entry.requiresDiscovery).toBeUndefined()
  })

  it('covers the shipped discovery set ids', () => {
    expect(DISCOVERY_TOOL_IDS).toContain('nmap')
    expect(DISCOVERY_TOOL_IDS.length).toBeGreaterThanOrEqual(7)
  })
})
