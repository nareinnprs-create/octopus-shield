import { describe, expect, it } from 'vitest'
import {
  appendShieldRpcOutput,
  resolveShieldCliCommand,
  resolveShieldCliInvocation
} from './live-remote-freeze-rpc.mjs'

describe('live remote freeze RPC', () => {
  it('resolves the Shield CLI for managed, dev, Linux, and default runtimes', () => {
    expect(resolveShieldCliCommand({ env: { OSHIELD_CLI_COMMAND: 'custom-shield' } })).toBe('custom-shield')
    expect(resolveShieldCliCommand({ env: { OSHIELD_DEV_REPO_ROOT: '/repo' } })).toBe('shield-dev')
    expect(resolveShieldCliCommand({ env: {}, platform: 'linux' })).toBe('shield-ide')
    expect(resolveShieldCliCommand({ env: {}, platform: 'win32' })).toBe('shield')
  })

  it('bypasses the Windows dev cmd shim with the built Node CLI', () => {
    const invocation = resolveShieldCliInvocation({
      env: {
        APPDATA: 'C:\\Users\\dev\\AppData\\Roaming',
        OSHIELD_CLI_COMMAND: 'C:\\repo\\out\\bin\\shield-dev.cmd',
        OSHIELD_DEV_REPO_ROOT: 'C:\\repo'
      },
      platform: 'win32',
      nodeExecutable: 'C:\\Program Files\\nodejs\\node.exe'
    })

    expect(invocation).toMatchObject({
      command: 'C:\\Program Files\\nodejs\\node.exe',
      prefixArgs: ['C:\\repo\\out\\cli\\index.js'],
      env: {
        OSHIELD_USER_DATA_PATH: 'C:\\Users\\dev\\AppData\\Roaming\\shield-dev',
        OSHIELD_DEV_CLI_INVOCATION: '1',
        OSHIELD_APP_EXECUTABLE: 'C:\\repo\\node_modules\\electron\\dist\\electron.exe',
        OSHIELD_APP_EXECUTABLE_NEEDS_APP_ROOT: '1'
      }
    })
  })

  it('caps combined asynchronous output before retaining the overflow chunk', () => {
    const first = appendShieldRpcOutput('', '1234', 0, 5)
    expect(first).toEqual({ output: '1234', bytes: 4, exceeded: false })

    const overflow = appendShieldRpcOutput(first.output, '67', first.bytes, 5)
    expect(overflow).toEqual({ output: '1234', bytes: 6, exceeded: true })
  })
})
