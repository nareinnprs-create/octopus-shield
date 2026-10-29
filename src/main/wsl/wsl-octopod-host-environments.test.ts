import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import {
  observeWslOctopodHostResponse,
  onWslOctopodHostAutomationsChanged,
  registerWslOctopodHostEnvironment,
  unregisterWslOctopodHostEnvironment,
  wslOctopodHostSupports
} from './wsl-octopod-host-environments'

const CAPABILITY = 'agent-session.account-env.v1'

function status(capabilities: string[]): RuntimeRpcResponse<unknown> {
  return { id: 'status.get', ok: true, result: { capabilities }, _meta: { runtimeId: 'r' } }
}

describe('wslOctopodHostSupports', () => {
  afterEach(() => unregisterWslOctopodHostEnvironment('env-1', 'Ubuntu'))

  it('asks the host once, then answers from what it reported', async () => {
    registerWslOctopodHostEnvironment('env-1', 'Ubuntu')
    const readStatus = vi.fn(async () => status([CAPABILITY]))
    await expect(wslOctopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
    await expect(wslOctopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
    expect(readStatus).toHaveBeenCalledTimes(1)
  })

  it('reports an older host as unsupported and a failed probe as unknown', async () => {
    registerWslOctopodHostEnvironment('env-1', 'Ubuntu')
    await expect(wslOctopodHostSupports('env-1', CAPABILITY, async () => status([]))).resolves.toBe(
      'unsupported'
    )
    registerWslOctopodHostEnvironment('env-1', 'Ubuntu')
    await expect(
      wslOctopodHostSupports('env-1', CAPABILITY, async () => {
        throw new Error('offline')
      })
    ).resolves.toBe('unknown')
    const failure: RuntimeRpcResponse<unknown> = {
      id: 'status.get',
      ok: false,
      error: { code: 'x', message: 'x' }
    }
    await expect(wslOctopodHostSupports('env-1', CAPABILITY, async () => failure)).resolves.toBe(
      'unknown'
    )
  })

  it("follows a renderer's status.get and forgets it on reconnect", async () => {
    registerWslOctopodHostEnvironment('env-1', 'Ubuntu')
    observeWslOctopodHostResponse('env-1', 'status.get', status([]))
    const readStatus = vi.fn(async () => status([CAPABILITY]))
    await expect(wslOctopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('unsupported')
    observeWslOctopodHostResponse('env-1', 'terminal.list', status([CAPABILITY]))
    await expect(wslOctopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('unsupported')
    // A reconnect may be a redeployed octopod.
    registerWslOctopodHostEnvironment('env-1', 'Ubuntu')
    await expect(wslOctopodHostSupports('env-1', CAPABILITY, readStatus)).resolves.toBe('supported')
  })

  it('records nothing for an environment that is not a WSL octopod', async () => {
    observeWslOctopodHostResponse('ssh-1', 'status.get', status([CAPABILITY]))
    await expect(wslOctopodHostSupports('ssh-1', CAPABILITY, async () => status([]))).resolves.toBe(
      'unknown'
    )
  })
})

describe('onWslOctopodHostAutomationsChanged (E9)', () => {
  afterEach(() => unregisterWslOctopodHostEnvironment('env-1', 'Ubuntu'))

  it('tells the wake schedule when this desktop changed a WSL host’s automations', () => {
    registerWslOctopodHostEnvironment('env-1', 'Ubuntu')
    const listener = vi.fn()
    const stop = onWslOctopodHostAutomationsChanged(listener)
    const ok = (id: string): RuntimeRpcResponse<unknown> => ({
      id,
      ok: true,
      result: {},
      _meta: { runtimeId: 'r' }
    })
    observeWslOctopodHostResponse('env-1', 'automation.delete', ok('automation.delete'))
    observeWslOctopodHostResponse('env-1', 'automation.update', ok('automation.update'))
    observeWslOctopodHostResponse('env-1', 'automation.list', ok('automation.list'))
    observeWslOctopodHostResponse('ssh-box', 'automation.create', ok('automation.create'))
    expect(listener.mock.calls).toEqual([['env-1'], ['env-1']])
    stop()
  })
})
