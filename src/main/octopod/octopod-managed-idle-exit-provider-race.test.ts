import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/octopod-managed-launch-env'
import { bindOctopodIdleShutdown, beginOctopodIdleExit } from './octopod-managed-idle-exit-host'
import { installOctopodManagedIdleExit } from './octopod-managed-idle-exit'
import type * as ManagedIdleExit from './octopod-managed-idle-exit'
import type * as DaemonProviderState from '../daemon/daemon-provider-state'
import { retireOctopodDaemonIfIdle } from './octopod-daemon-retirement'
import { discardOctopodIdleStopRecord } from './octopod-idle-stop-record'
import { restartDaemon } from '../daemon/daemon-provider-restart'

const { hasLoadedProviders } = vi.hoisted(() => ({ hasLoadedProviders: vi.fn(() => false) }))

vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => ({ hasLoadedProviders })
}))
vi.mock('../ipc/pty/provider/registry', () => ({
  getLocalPtyProvider: () => ({ listProcesses: async () => [] })
}))
vi.mock('../daemon/daemon-init', () => ({ getDaemonEndpointFacts: () => null }))
vi.mock('./octopod-daemon-retirement', () => ({
  countLiveOctopodDaemonSessions: vi.fn(async () => 0),
  retireOctopodDaemonIfIdle: vi.fn()
}))
vi.mock('../daemon/daemon-provider-state', async (importOriginal) => ({
  ...(await importOriginal<typeof DaemonProviderState>()),
  getCurrentDaemonPid: () => 4242
}))
vi.mock('../daemon/daemon-provider-restart', () => ({ restartDaemon: vi.fn(async () => ({})) }))
vi.mock('./octopod-idle-stop-record', () => ({
  consumeOctopodIdleStopRecord: vi.fn(() => null),
  discardOctopodIdleStopRecord: vi.fn(),
  writeOctopodIdleStopRecord: vi.fn()
}))
vi.mock('./octopod-managed-idle-exit', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedIdleExit>()),
  installOctopodManagedIdleExit: vi.fn(() => () => {})
}))

beforeEach(() => {
  vi.clearAllMocks()
  hasLoadedProviders.mockReturnValue(false)
  vi.stubEnv(OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV, 'test-fence')
})

afterEach(() => vi.unstubAllEnvs())

it.each(['provider', 'client', 'request', 'recent request'])(
  'rechecks a returning %s after daemon retirement before requesting an idle shutdown',
  async (returning) => {
    const activity = { openConnections: 0, requestsInFlight: 0, lastRequestAt: 0 }
    const retire = Promise.withResolvers<{ retirement: string; reason: null }>()
    vi.mocked(retireOctopodDaemonIfIdle).mockImplementationOnce(async () => ({
      ...(await retire.promise),
      retirement: 'retired',
      liveSessions: 0
    }))
    const shutdown = vi.fn(() => true)
    bindOctopodIdleShutdown(shutdown)
    await beginOctopodIdleExit('test-profile').start({
      rpc: {
        readClientActivity: () => activity
      },
      agentStates: () => [],
      hasStagedMigration: () => false,
      automationsBusy: () => false,
      emulatorsBusy: async () => false,
      registerCleanup: () => {}
    })
    const installed = vi.mocked(installOctopodManagedIdleExit).mock.calls.at(-1)?.[0]
    if (!installed) {
      throw new Error('idle monitor was not installed')
    }
    const stopping = installed.stop({ quietSince: 0, stoppedAt: 900_000, timeoutMs: 900_000 })
    hasLoadedProviders.mockReturnValue(returning === 'provider')
    activity.openConnections = returning === 'client' ? 1 : 0
    activity.requestsInFlight = returning === 'request' ? 1 : 0
    activity.lastRequestAt = returning === 'recent request' ? 1 : 0
    retire.resolve({ retirement: 'retired', reason: null })

    expect(await stopping).toBe(false)
    expect(shutdown).not.toHaveBeenCalled()
    expect(discardOctopodIdleStopRecord).toHaveBeenCalledWith('test-profile')
    expect(restartDaemon).toHaveBeenCalledOnce()
  }
)
