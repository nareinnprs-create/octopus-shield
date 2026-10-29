import { describe, expect, it } from 'vitest'
import { parseWindowsHostCellDescriptor, windowsHostSshTarget } from './ssh-windows-host-cells'

const DESCRIPTOR = {
  cell: 'octopod-powershell',
  target: 'win32-arm64',
  host: '127.0.0.1',
  port: 50022,
  username: 'shieldabc',
  identityFile: 'C:\\ossh\\client_key',
  home: 'C:/Users/shieldabc',
  forbiddenToolLog: 'C:\\ossh\\forbidden.log',
  receipt: 'C:\\receipts\\octopod-powershell.json'
}

describe('Windows SSH-host cells', () => {
  it('reads the descriptor PowerShell writes, BOM included', () => {
    const parsed = parseWindowsHostCellDescriptor(`\uFEFF${JSON.stringify(DESCRIPTOR)}`)
    expect(parsed).toEqual(DESCRIPTOR)
    expect(windowsHostSshTarget(parsed, 'r1')).toMatchObject({
      id: 'windows-host-octopod-powershell-r1',
      host: '127.0.0.1',
      port: 50022,
      username: 'shieldabc',
      identityFile: 'C:\\ossh\\client_key',
      identitiesOnly: true,
      remoteRuntime: 'pinned-node'
    })
  })

  it('rejects a descriptor that would drive the wrong host or cell', () => {
    const parse = (patch: Record<string, unknown>): unknown =>
      parseWindowsHostCellDescriptor(JSON.stringify({ ...DESCRIPTOR, ...patch }))
    expect(() => parse({ cell: 'pinned-cmd' })).toThrow('Unknown Windows host cell')
    expect(() => parse({ cell: 'octopod-cli-relay-kept' })).toThrow('Unknown Windows host cell')
    for (const cell of ['octopod-cmd', 'octopod-convert', 'octopod-cli-managed', 'octopod-cli-convert']) {
      expect(parseWindowsHostCellDescriptor(JSON.stringify({ ...DESCRIPTOR, cell })).cell).toBe(
        cell
      )
    }
    expect(() => parse({ target: 'linux-x64-glibc' })).toThrow('win32-x64 or win32-arm64')
    expect(() => parse({ port: '22' })).toThrow('port is invalid')
    expect(() => parse({ port: 70_000 })).toThrow('port is invalid')
    expect(() => parse({ home: '' })).toThrow('non-empty string home')
    expect(() => parseWindowsHostCellDescriptor('[]')).toThrow('must be a JSON object')
  })
})
