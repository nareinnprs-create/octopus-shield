import { describe, expect, it, vi } from 'vitest'
import { HostAccountLaunchEnvParams } from '../../shared/host-account-launch-env'
import { HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY } from '../../shared/octopod-runtime-capabilities'
import type { WslOctopodAccountEnvDependencies } from './wsl-octopod-account-env'
import type { WslOctopodHostCapabilityVerdict } from './wsl-octopod-host-environments'
import {
  changesWslHostAccounts,
  pushWslOctopodHostAccountEnv,
  type WslOctopodHostAccountPush
} from './wsl-octopod-host-account-push'

const POINTER = '~/.shield-claude-profile-pointer-test'
const CLAUDE_HOME = '/home/u/.shield/claude-accounts/acct-a/config'

function dependencies(
  overrides: Partial<WslOctopodAccountEnvDependencies> = {}
): WslOctopodAccountEnvDependencies {
  return {
    prepareClaudeLaunch: vi.fn(async () => ({
      configDir: CLAUDE_HOME,
      runtime: 'wsl' as const,
      wslDistro: 'Ubuntu',
      envPatch: {
        CLAUDE_CONFIG_DIR: CLAUDE_HOME,
        OSHIELD_CLAUDE_INJECTED_CONFIG_DIR: CLAUDE_HOME
      },
      provenance: 'profile:acct-a:wsl:Ubuntu'
    })),
    claudeTerminalEnv: vi.fn(() => ({ OSHIELD_CLAUDE_PROFILE_POINTER: POINTER })),
    prepareCodexHome: vi.fn(async () => '\\\\wsl.localhost\\Ubuntu\\home\\u\\.shield\\codex-b'),
    managedAccountSelected: vi.fn(() => true),
    accountNotApplied: vi.fn(),
    ...overrides
  }
}

function push(
  verdict: WslOctopodHostCapabilityVerdict,
  call: WslOctopodHostAccountPush['call'] = vi.fn(async () => ({
    id: 'accounts.setHostLaunchEnv',
    ok: true as const,
    result: {},
    _meta: { runtimeId: 'r' }
  }))
): WslOctopodHostAccountPush {
  return {
    environmentId: 'wsl:Ubuntu',
    distro: 'Ubuntu',
    hostSupports: vi.fn(async () => verdict),
    call
  }
}

describe('pushWslOctopodHostAccountEnv', () => {
  it("gives the host its distro's selected accounts, valid on the wire", async () => {
    const target = push('supported')
    await pushWslOctopodHostAccountEnv(target, dependencies())
    expect(target.hostSupports).toHaveBeenCalledWith(HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY)
    const [method, params] = vi.mocked(target.call).mock.calls[0]
    expect(method).toBe('accounts.setHostLaunchEnv')
    expect(HostAccountLaunchEnvParams.parse(params)).toEqual({
      wslDistro: 'Ubuntu',
      claude: {
        CLAUDE_CONFIG_DIR: CLAUDE_HOME,
        OSHIELD_CLAUDE_INJECTED_CONFIG_DIR: CLAUDE_HOME,
        CODEX_HOME: '/home/u/.shield/codex-b'
      },
      terminal: {
        OSHIELD_CLAUDE_PROFILE_POINTER: POINTER,
        CODEX_HOME: '/home/u/.shield/codex-b'
      }
    })
  })

  it('tells the user once an older host cannot take a selected account, and sends nothing', async () => {
    const deps = dependencies()
    const target = push('unsupported')
    await pushWslOctopodHostAccountEnv(target, deps)
    expect(target.call).not.toHaveBeenCalled()
    expect(deps.accountNotApplied).toHaveBeenCalledWith('Ubuntu')
  })

  it('neither sends nor warns while the host cannot be asked, and retries', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const deps = dependencies()
      const target = push('unknown')
      await pushWslOctopodHostAccountEnv(target, deps, [1_000])
      expect(target.call).not.toHaveBeenCalled()
      expect(deps.accountNotApplied).not.toHaveBeenCalled()
      vi.mocked(target.hostSupports).mockResolvedValue('supported')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(target.call).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('lands pushes in order, so an older selection never overwrites a newer one', async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const slowFirst = new Promise<void>((resolve) => {
      release = resolve
    })
    const deps = (home: string, gate?: Promise<void>) =>
      dependencies({
        prepareCodexHome: vi.fn(async () => {
          await gate
          return home
        })
      })
    const call: WslOctopodHostAccountPush['call'] = vi.fn(async (_method, params) => {
      order.push(HostAccountLaunchEnvParams.parse(params).terminal.CODEX_HOME ?? '')
      return {
        id: 'm',
        ok: true as const,
        result: {},
        _meta: { runtimeId: 'r' }
      }
    })
    const first = pushWslOctopodHostAccountEnv(push('supported', call), deps('/old', slowFirst))
    const second = pushWslOctopodHostAccountEnv(push('supported', call), deps('/new'))
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['/old', '/new'])
  })
})

describe('changesWslHostAccounts', () => {
  it('fires on a selection or roster change only', () => {
    expect(
      changesWslHostAccounts({
        activeCodexManagedAccountIdsByRuntime: undefined
      })
    ).toBe(true)
    expect(changesWslHostAccounts({ claudeManagedAccounts: [] })).toBe(true)
    expect(changesWslHostAccounts({ experimentalWslHosts: true })).toBe(false)
  })
})

describe('pushWslOctopodHostAccountEnv retries', () => {
  it('retries a failed push, and stops once a newer push supersedes it', async () => {
    vi.useFakeTimers()
    try {
      const call = vi
        .fn<WslOctopodHostAccountPush['call']>()
        .mockResolvedValueOnce({
          id: 'm',
          ok: false,
          error: { code: 'unavailable', message: 'down' },
          _meta: { runtimeId: 'r' }
        })
        .mockResolvedValue({ id: 'm', ok: true, result: {}, _meta: { runtimeId: 'r' } })
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      await pushWslOctopodHostAccountEnv(push('supported', call), dependencies(), [1_000])
      expect(call).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(call).toHaveBeenCalledTimes(2)

      const failing = vi.fn<WslOctopodHostAccountPush['call']>().mockResolvedValue({
        id: 'm',
        ok: false,
        error: { code: 'unavailable', message: 'down' },
        _meta: { runtimeId: 'r' }
      })
      await pushWslOctopodHostAccountEnv(push('supported', failing), dependencies(), [1_000])
      await pushWslOctopodHostAccountEnv(push('supported', call), dependencies(), [1_000])
      await vi.advanceTimersByTimeAsync(5_000)
      expect(failing).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})
