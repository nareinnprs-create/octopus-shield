import { describe, expect, it } from 'vitest'

import { buildArgv, runArmoryTool, type ArmoryRunRequest } from './tool-runner'
import type { ArmoryToolDescriptor } from './tool-registry'
import { parseArmoryScope } from './tool-scope'

const tool = (overrides: Partial<ArmoryToolDescriptor> = {}): ArmoryToolDescriptor => ({
  id: 'nmap',
  title: 'nmap',
  category: 'recon',
  runtime: 'docker',
  target: 'nmap:latest',
  versionArgv: ['--version'],
  scopeClass: 'recon',
  status: 'ok',
  ...overrides
})

const request = (overrides: Partial<ArmoryRunRequest> = {}): ArmoryRunRequest => ({
  args: ['-p', '80'],
  targets: ['192.168.1.10'],
  scope: parseArmoryScope('192.168.1.0/24'),
  ...overrides
})

describe('buildArgv', () => {
  it('docker runtime wraps the image with docker run --rm', () => {
    expect(buildArgv(tool({ runtime: 'docker', target: 'nmap:latest' }), ['-sV', 'host'])).toEqual({
      ok: true,
      argv: ['docker', 'run', '--rm', 'nmap:latest', '-sV', 'host']
    })
  })

  it('wsl runtime drives the distro user entrypoint', () => {
    expect(
      buildArgv(tool({ runtime: 'wsl', target: '/usr/bin/nmap' }), ['-p', '80'])
    ).toEqual({
      ok: true,
      argv: ['wsl', '-d', 'Ubuntu', '-u', 'root', '-e', '/usr/bin/nmap', '-p', '80']
    })
  })

  it('win runtime requires an absolute target path and passes it through directly', () => {
    expect(buildArgv(tool({ runtime: 'win', target: 'C:\\tools\\nmap.exe' }), ['-p', '80'])).toEqual({
      ok: true,
      argv: ['C:\\tools\\nmap.exe', '-p', '80']
    })
    expect(buildArgv(tool({ runtime: 'win', target: '\\\\server\\share\\tool.exe' }), []).ok).toBe(true)
  })

  it('win runtime rejects relative target paths before anything spawns', () => {
    for (const relative of ['nmap.exe', 'tools\\nmap.exe', './nmap.exe']) {
      const result = buildArgv(tool({ runtime: 'win', target: relative }), [])
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('absolute path')
      }
    }
  })
})

describe('runArmoryTool — deny paths (no process is ever spawned)', () => {
  it('refuses tools whose inventory status is not ok', async () => {
    for (const status of ['failed', 'quarantined-by-av', 'skipped'] as const) {
      const result = await runArmoryTool(tool({ status }), request())
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain(`tool nmap is not installed (status: ${status})`)
      }
    }
  })

  it('refuses out-of-scope targets', async () => {
    const result = await runArmoryTool(tool(), request({ targets: ['10.0.0.1'] }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('outside authorized scope')
      expect(result.reason).toContain('10.0.0.1')
    }
  })

  it('refuses runs with no targets at all', async () => {
    const result = await runArmoryTool(tool(), request({ targets: [] }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('outside authorized scope')
      expect(result.reason).toContain('(no targets given)')
    }
  })

  it('partially-in-scope target lists are denied wholesale', async () => {
    const result = await runArmoryTool(tool(), request({ targets: ['192.168.1.10', '192.168.2.10'] }))
    expect(result.ok).toBe(false)
  })

  it('exploitation-class tools require the explicit exploit authorization', async () => {
    const exploitTool = tool({ id: 'metasploit', scopeClass: 'exploitation', runtime: 'docker', target: 'metasploit:latest' })
    for (const exploitAuthorized of [undefined, false] as const) {
      const result = await runArmoryTool(exploitTool, request({ exploitAuthorized }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('OSHIELD_ARMORY_EXPLOIT_AUTHORIZED=1')
      }
    }
  })

  it('post-exploitation-class tools require the explicit exploit authorization', async () => {
    const mimikatz = tool({ id: 'mimikatz', scopeClass: 'post-exploitation', runtime: 'wsl', target: '/opt/mimikatz' })
    const result = await runArmoryTool(mimikatz, request())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('post-exploitation-class')
    }
  })

  it('a non-ok status denies before scope or class checks', async () => {
    const result = await runArmoryTool(tool({ status: 'failed', scopeClass: 'exploitation' }), request({ targets: ['10.9.9.9'] }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('not installed')
    }
  })
})
