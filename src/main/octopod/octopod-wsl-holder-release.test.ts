import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setAppEnvironment } from '../../shared/app-environment'
import { OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/octopod-managed-launch-env'
import { createAdapter } from '../daemon/daemon-pty-router-test-fixture'
import { DaemonPtyRouter } from '../daemon/daemon-pty-router'
import { installDaemonProvider } from '../daemon/daemon-provider-state'
import type { DaemonIdleRetirementResult } from '../daemon/daemon-pty-runtime-state'
import { PROTOCOL_VERSION } from '../daemon/types'
import {
  beginOctopodIdleExit,
  bindOctopodIdleShutdown,
  createIdleStopRecordOwnership
} from './octopod-managed-idle-exit-host'
import { installOctopodManagedIdleExit } from './octopod-managed-idle-exit'
import type * as ManagedIdleExit from './octopod-managed-idle-exit'
import { octopodWslHolderReleasePath } from './octopod-wsl-holder-release'
import { OCTOPOD_WSL_HOST_ENV } from '../ipc/wsl-guest-windows-drive-path'

vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => ({ hasLoadedProviders: () => false })
}))
vi.mock('./octopod-managed-idle-exit', async (importOriginal) => ({
  ...(await importOriginal<typeof ManagedIdleExit>()),
  installOctopodManagedIdleExit: vi.fn(() => () => {})
}))

let root: string

beforeEach(() => {
  vi.clearAllMocks()
  root = mkdtempSync(join(tmpdir(), 'octopod-wsl-holder-release-'))
  vi.stubEnv(OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV, join(root, 'fence'))
  vi.stubEnv(OCTOPOD_WSL_HOST_ENV, '1')
  vi.spyOn(console, 'error').mockImplementation(() => {})
  setAppEnvironment({
    getPath: () => root,
    getAppPath: () => root,
    getVersion: () => '0.0.0-test',
    isPackaged: () => false,
    onWillQuit: () => {},
    exit: () => {},
    getAppMetrics: () => []
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

async function idleStop(
  retirement: DaemonIdleRetirementResult,
  options: { clientReturns?: boolean; shutdownAccepted?: boolean } = {}
) {
  const current = createAdapter('current', [], undefined, PROTOCOL_VERSION)
  vi.mocked(current.requestIdleRetirement).mockResolvedValue(retirement)
  installDaemonProvider(null, new DaemonPtyRouter({ current, legacy: [] }))
  const activity = { openConnections: 0, requestsInFlight: 0, lastRequestAt: 0 }
  const shutdown = vi.fn(() => options.shutdownAccepted ?? true)
  bindOctopodIdleShutdown(shutdown)
  await beginOctopodIdleExit(root).start({
    rpc: { readClientActivity: () => activity },
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
  if (options.clientReturns) {
    activity.openConnections = 1
  }
  const stopped = await installed.stop({ quietSince: 0, stoppedAt: 900_000, timeoutMs: 900_000 })
  return { stopped, shutdown }
}

it('asks the WSL holder to let go once an idle stop retired the terminal daemon', async () => {
  const { stopped } = await idleStop({ state: 'retiring' })

  expect(stopped).toBe(true)
  expect(readFileSync(octopodWslHolderReleasePath(root), 'utf8')).toBe(`${process.pid}\n`)
})

it.each([
  ['live terminals keep the daemon', { state: 'busy', liveSessions: 2 } as const],
  ['the daemon could not be proven idle', { state: 'unverifiable' } as const]
])('keeps the distro held when %s', async (_name, retirement) => {
  await idleStop(retirement)

  expect(existsSync(octopodWslHolderReleasePath(root))).toBe(false)
})

it('keeps the distro held when a client returned during the stop', async () => {
  await idleStop({ state: 'retiring' }, { clientReturns: true })

  expect(existsSync(octopodWslHolderReleasePath(root))).toBe(false)
})

it('never writes the request for an octopod no WSL host launched', async () => {
  vi.stubEnv(OCTOPOD_WSL_HOST_ENV, '')
  await idleStop({ state: 'retiring' })

  expect(existsSync(octopodWslHolderReleasePath(root))).toBe(false)
})

it('withdraws the request when another stop took the shutdown over', async () => {
  await idleStop({ state: 'retiring' }, { shutdownAccepted: false })

  expect(existsSync(octopodWslHolderReleasePath(root))).toBe(false)
})

it('withdraws the request when a stop it asked for ends some other way', () => {
  writeFileSync(octopodWslHolderReleasePath(root), '123\n')
  createIdleStopRecordOwnership(root).onShutdown()

  expect(existsSync(octopodWslHolderReleasePath(root))).toBe(false)
})

it('withdraws an earlier request when a new octopod starts', () => {
  writeFileSync(octopodWslHolderReleasePath(root), '123\n')
  beginOctopodIdleExit(root)

  expect(existsSync(octopodWslHolderReleasePath(root))).toBe(false)
})

it('never touches the request path for an octopod no WSL host launched', () => {
  vi.stubEnv(OCTOPOD_WSL_HOST_ENV, '')
  writeFileSync(octopodWslHolderReleasePath(root), '123\n')
  beginOctopodIdleExit(root)

  expect(existsSync(octopodWslHolderReleasePath(root))).toBe(true)
})

it('never throws at start when the request cannot be removed', () => {
  // A directory in its place fails the removal like a locked or unwritable file would.
  mkdirSync(join(octopodWslHolderReleasePath(root), 'stuck'), { recursive: true })

  expect(() => beginOctopodIdleExit(root)).not.toThrow()
})
