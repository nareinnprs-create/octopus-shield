import { rmSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listEnvironments } from '../../shared/runtime-environment-store'
import { OCTOPOD_UPDATE_ADMISSION_FENCE_MS } from '../../shared/octopod-terminal-census'
import {
  moveManagedOctopodLocalPort,
  recordManagedOctopodMigration,
  refreshManagedOctopodPairing
} from '../../shared/runtime-environment-managed-octopod-store'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'
import {
  octopodUpdateFailedThisLaunch,
  recordOctopodUpdateFailedThisLaunch
} from '../managed-server/lifecycle/octopod-managed-update-failure-memory'
import { octopodMigrationCutoverFixture } from './octopod-migration-cutover-fixture'
import { writeOctopodMigrationSourceCutover } from './octopod-migration-cutover-journal'
import {
  createManagedLifecycleHarness,
  MANAGED_LOCAL_PORT,
  MANAGED_PREVIOUS_VERSION,
  MANAGED_VERSION,
  managedReadiness
} from '../managed-server/lifecycle/octopod-managed-lifecycle-test-fixture'

const mocks = vi.hoisted(() => {
  const state: { store: unknown } = { store: null }
  return {
    state,
    resolveContext: vi.fn(),
    census: vi.fn(),
    deploy: vi.fn(),
    rollback: vi.fn(),
    recover: vi.fn(),
    probe: vi.fn(),
    buildHash: vi.fn(),
    ensureTunnel: vi.fn(),
    rebuildTunnel: vi.fn(),
    wake: vi.fn(),
    pendingMigration: vi.fn()
  }
})

vi.mock('./targets/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({ connect: async () => ({}) }),
  getSshTargetRegistryStore: () => mocks.state.store
}))
vi.mock('../managed-server/install/octopod-remote-context', () => ({
  resolveOctopodRemoteContext: mocks.resolveContext
}))
vi.mock('./octopod-terminal-census-client', () => ({ collectManagedTerminalCensus: mocks.census }))
vi.mock('./octopod-remote-deploy', () => ({ deployOctopod: mocks.deploy }))
vi.mock('../managed-server/install/octopod-remote-rollback', () => ({
  rollbackOctopod: mocks.rollback
}))
vi.mock('../managed-server/activation/octopod-activation-recovery', () => ({
  recoverInterruptedOctopodActivation: mocks.recover
}))
vi.mock('./octopod-active-readiness', () => ({ probeActiveOctopodReadiness: mocks.probe }))
vi.mock('../managed-server/install/octopod-remote-build-hash', () => ({
  readRemoteOctopodBuildHash: mocks.buildHash
}))
vi.mock('../octopod/octopod-artifact-materializer', () => ({
  materializeOctopodArtifact: async () => '/local/octopod'
}))
vi.mock('./octopod-local-build-hash', () => ({ computeLocalOctopodBuildHash: () => 'local-hash' }))
vi.mock('../managed-server/lifecycle/octopod-managed-tunnel', () => ({
  ensureOctopodManagedTunnel: mocks.ensureTunnel,
  rebuildOctopodManagedTunnel: mocks.rebuildTunnel
}))
vi.mock('../managed-server/lifecycle/octopod-managed-wake', () => ({
  wakeStoppedManagedOctopod: mocks.wake
}))
vi.mock('../managed-server/lifecycle/octopod-managed-migration-status', () => ({
  findIncompleteManagedOctopodMigration: mocks.pendingMigration
}))
vi.mock('../managed-server/activation/octopod-activation-transaction-store', () => ({
  readOctopodActivationTransaction: async () => null
}))

const { getManagedOctopodRuntimeStatus } =
  await import('../managed-server/lifecycle/octopod-runtime-status')
const {
  recoverManagedOctopodEnvironment,
  rollbackManagedOctopodEnvironment,
  updateManagedOctopodEnvironment
} = await import('./octopod-runtime-maintenance')

const idle = { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: 7 }
let harness: ReturnType<typeof createManagedLifecycleHarness>

beforeEach(() => {
  vi.resetAllMocks()
  harness = createManagedLifecycleHarness()
  mocks.state.store = harness.targetStore
  mocks.resolveContext.mockImplementation(async () => harness.context())
  mocks.census.mockResolvedValue(idle)
  mocks.probe.mockResolvedValue(managedReadiness())
  mocks.buildHash.mockResolvedValue('previous-hash')
  mocks.recover.mockResolvedValue({ outcome: 'none' })
  mocks.wake.mockResolvedValue({ outcome: 'serving' })
})

afterEach(() => rmSync(harness.userDataPath, { recursive: true, force: true }))

function expectEnrolledPairing(): void {
  const [environment] = listEnvironments(harness.userDataPath)
  expect(environment?.endpoints[0]?.deviceToken).toBe('device-token')
  expect(environment?.pairingRevision).toBe(harness.environment.pairingRevision)
  expect(environment?.octopodDeployment).toEqual(harness.environment.octopodDeployment)
}

describe('updateManagedOctopodEnvironment', () => {
  it('defers over live or unverifiable terminals and reports the deferral in status', async () => {
    mocks.census.mockResolvedValue({ ...idle, liveSessions: null })
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-not-activated',
      fullVersion: '0.3.0+new',
      code: 'octopod_update_terminal_census_unavailable',
      reason: 'The terminal daemon did not answer a session count.'
    })
    const result = await updateManagedOctopodEnvironment(harness.userDataPath, {
      selector: 'Managed'
    })
    expect(result).toMatchObject({ outcome: 'deferred', forceable: false })
    expect(mocks.deploy.mock.calls[0]?.[0]).toMatchObject({
      census: { liveSessions: null },
      port: 6_768,
      nodePath: ''
    })
    const status = await getManagedOctopodRuntimeStatus(harness.userDataPath, 'Managed')
    expect(status.deferredUpdate).toMatchObject({
      candidateVersion: '0.3.0+new',
      code: 'octopod_update_terminal_census_unavailable'
    })
    expect(status.terminals.liveSessions).toBeNull()
  })

  it('clears the deferral once an update goes through and keeps an unchanged pairing as is', async () => {
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-not-activated',
      fullVersion: '0.3.0+new',
      code: 'octopod_update_terminals_running',
      reason: 'busy'
    })
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-and-activated',
      fullVersion: '0.3.0+new'
    })
    const result = await updateManagedOctopodEnvironment(harness.userDataPath, {
      selector: 'Managed',
      force: true
    })
    expect(result).toMatchObject({ outcome: 'updated', activeVersion: '0.3.0+new' })
    expect(mocks.probe).toHaveBeenCalledWith(expect.anything(), {
      buildHash: 'local-hash',
      fullVersion: '0.3.0+new'
    })
    const [environment] = listEnvironments(harness.userDataPath)
    expect(environment?.pairingRevision).toBe(harness.environment.pairingRevision)
    expect(environment?.octopodDeployment).toEqual(harness.environment.octopodDeployment)
    const status = await getManagedOctopodRuntimeStatus(harness.userDataPath, 'Managed')
    expect(status.deferredUpdate).toBeNull()
  })

  it('keeps a connect from retrying a build an explicit Update also failed', async () => {
    const host = { kind: 'ssh', id: 'ssh-1' } as const
    recordOctopodUpdateFailedThisLaunch(host, { code: 'octopod_update_failed', reason: 'rejected' })
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-not-activated',
      fullVersion: 'v3',
      code: 'octopod_candidate_readiness_rejected',
      reason: 'rejected again'
    })
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expect(octopodUpdateFailedThisLaunch(host)).toBe(true)
  })

  it('refuses Update over a host a newer Shield runs, and lets Force take it', async () => {
    const newer = {
      ...harness.context().activationRecord,
      active: '9.0.0+newer',
      activeAppVersion: '99.0.0'
    }
    mocks.deploy.mockResolvedValue({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expect(mocks.deploy.mock.calls[0]?.[0].admitRecord(newer, 'v3')).toMatch(/last ran/)
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed', force: true })
    expect(mocks.deploy.mock.calls[1]?.[0].admitRecord(newer, 'v3')).toBeNull()
  })

  it('updates past live terminals only over the confirmed build, keeping the downgrade refusal', async () => {
    const running = {
      ...harness.context().activationRecord,
      active: 'v1',
      activeAppVersion: '0.0.0-test'
    }
    mocks.deploy.mockResolvedValue({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    await updateManagedOctopodEnvironment(harness.userDataPath, {
      selector: 'Managed',
      pastLiveTerminals: { incumbentVersion: 'v1' }
    })
    const deployed = mocks.deploy.mock.calls[0]?.[0]
    expect(deployed.force).toBe('live-terminals')
    expect(deployed.admitRecord(running, 'v3')).toBeNull()
    expect(deployed.admitRecord({ ...running, active: 'v2' }, 'v3')).toMatch(/changed since/)
    expect(
      deployed.admitRecord({ ...running, active: 'v1', activeAppVersion: '99.0.0' }, 'v3')
    ).toMatch(/last ran/)
  })

  it('offers Force when Update was refused by policy', async () => {
    mocks.deploy.mockResolvedValueOnce({
      outcome: 'installed-not-activated',
      fullVersion: 'v3',
      code: 'octopod_activation_policy_refused',
      reason: 'newer'
    })
    await expect(
      updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'deferred', forceable: true })
  })

  it('lets an explicit Update retry a build a connect remembered as failed', async () => {
    const host = { kind: 'ssh', id: 'ssh-1' } as const
    recordOctopodUpdateFailedThisLaunch(host, { code: 'octopod_update_failed', reason: 'rejected' })
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expect(octopodUpdateFailedThisLaunch(host)).toBe(false)
    expect(mocks.deploy.mock.calls[0]?.[0]).toMatchObject({ census: idle })
  })

  it('hands the deploy a recount that counts again, so a terminal opened during the upload counts', async () => {
    const opened = { ...idle, liveSessions: 1, inProcessSessions: 1 }
    mocks.census.mockResolvedValueOnce(idle).mockResolvedValue(opened)
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    const deployed = mocks.deploy.mock.calls[0]?.[0]
    expect(deployed?.recountCensus).toBeTypeOf('function')
    await expect(deployed!.recountCensus()).resolves.toEqual(opened)
    // Only final recount closes admission; initial counts can predate upload.
    expect(mocks.census.mock.calls.map((call) => call[4])).toEqual([
      { releaseFinishedAutomationTerminals: true },
      {
        releaseFinishedAutomationTerminals: true,
        closeAdmissionForMs: OCTOPOD_UPDATE_ADMISSION_FENCE_MS
      }
    ])
    await deployed!.releaseIncumbentAdmission()
    expect(mocks.census.mock.calls[2]?.[4]).toEqual({ closeAdmissionForMs: 0 })
  })

  it('forwards anew after an activation, since the new slot may bind another port', async () => {
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expect(mocks.rebuildTunnel).toHaveBeenCalledWith(harness.userDataPath, 'environment-1')
  })

  it('still reports the activation when the new forward cannot be built yet', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    mocks.rebuildTunnel.mockRejectedValueOnce(new Error('ssh connect failed'))
    await expect(
      updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'updated', activeVersion: 'v3' })
  })

  it('keeps a pairing the terminal count repaired, not the one read before it', async () => {
    mocks.census.mockImplementationOnce(async () => {
      refreshManagedOctopodPairing(
        harness.userDataPath,
        'environment-1',
        encodePairingOffer({
          v: PAIRING_OFFER_VERSION,
          endpoint: `ws://127.0.0.1:${MANAGED_LOCAL_PORT}/`,
          deviceToken: 'repaired-token',
          publicKeyB64: 'public-key'
        })
      )
      return idle
    })
    mocks.deploy.mockResolvedValueOnce({ outcome: 'already-active', fullVersion: MANAGED_VERSION })
    mocks.probe.mockResolvedValueOnce(managedReadiness('startup-offer-token'))
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    const [environment] = listEnvironments(harness.userDataPath)
    expect(environment?.endpoints[0]?.deviceToken).toBe('repaired-token')
  })

  it('keeps the enrolled grant when the updated server offers a new device', async () => {
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    mocks.probe.mockResolvedValueOnce(managedReadiness('startup-offer-token'))
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expectEnrolledPairing()
  })

  it('saves the new pairing on the tunnel port the census moved to', async () => {
    mocks.census.mockImplementationOnce(async () => {
      moveManagedOctopodLocalPort(harness.userDataPath, 'environment-1', MANAGED_LOCAL_PORT + 1)
      return idle
    })
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    mocks.probe.mockResolvedValueOnce(managedReadiness())

    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })

    const [environment] = listEnvironments(harness.userDataPath)
    expect(environment?.octopodDeployment?.localPort).toBe(MANAGED_LOCAL_PORT + 1)
    expect(environment?.endpoints[0]?.endpoint).toBe(`ws://127.0.0.1:${MANAGED_LOCAL_PORT + 1}/`)
  })
})

describe('updateManagedOctopodEnvironment on a host already running this build', () => {
  beforeEach(() => {
    mocks.deploy.mockResolvedValue({ outcome: 'already-active', fullVersion: MANAGED_VERSION })
  })

  it('starts a slot proven stopped and forwards to the port it bound', async () => {
    mocks.wake.mockResolvedValueOnce({ outcome: 'started', readiness: managedReadiness() })
    await expect(
      updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'already-current', activeVersion: MANAGED_VERSION })
    expect(mocks.wake.mock.calls[0]?.[0]).toMatchObject({ port: 6_768 })
    expect(mocks.rebuildTunnel).toHaveBeenCalledWith(harness.userDataPath, 'environment-1')
  })

  it.each(['serving', 'unverifiable', 'fenced'] as const)(
    'leaves a %s slot alone and keeps the tunnel',
    async (outcome) => {
      mocks.wake.mockResolvedValueOnce({ outcome })
      await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
      expect(mocks.rebuildTunnel).not.toHaveBeenCalled()
    }
  )

  it('does not wake after an activation, which launched the new slot itself', async () => {
    mocks.deploy.mockResolvedValueOnce({ outcome: 'installed-and-activated', fullVersion: 'v3' })
    await updateManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expect(mocks.wake).not.toHaveBeenCalled()
  })
})

describe('rollbackManagedOctopodEnvironment', () => {
  it.each([
    [{ ...idle, liveSessions: 2 }, 'octopod_rollback_terminals_running'],
    [{ ...idle, liveSessions: null }, 'octopod_rollback_census_unavailable']
  ])('refuses while terminals run or cannot be counted: %j', async (census, code) => {
    mocks.census.mockResolvedValue(census)
    await expect(
      rollbackManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code })
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it('refuses with no previous version without contacting the slot', async () => {
    mocks.resolveContext.mockImplementation(async () => harness.context({ previous: null }))
    await expect(
      rollbackManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code: 'octopod_rollback_no_target' })
    expect(mocks.census).not.toHaveBeenCalled()
  })

  it('refuses while a migration into the server is unfinished', async () => {
    mocks.pendingMigration.mockReturnValueOnce({ migrationId: 'm-1', phase: 'destination-staged' })
    await expect(
      rollbackManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code: 'octopod_rollback_migration_in_progress' })
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it('refuses a rollback to a snapshot older than the migrated catalog, not a newer one', async () => {
    recordManagedOctopodMigration(harness.userDataPath, 'environment-1', '2026-02-01T00:00:00.000Z')
    await expect(
      rollbackManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code: 'octopod_rollback_crosses_migration' })
    expect(mocks.rollback).not.toHaveBeenCalled()
    mocks.resolveContext.mockImplementation(async () =>
      harness.context({ activatedAt: '2026-03-01T00:00:00.000Z' })
    )
    mocks.rollback.mockResolvedValueOnce({ outcome: 'refused', code: 'x', reason: 'y' })
    await rollbackManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expect(mocks.rollback).toHaveBeenCalledOnce()
  })

  it('refuses a rollback across a retained delta move that predates the mark', async () => {
    // Older deltas lack a durable mark; their retained journal must still block destructive rollback.
    writeOctopodMigrationSourceCutover(harness.userDataPath, {
      ...octopodMigrationCutoverFixture('delta-1', 'ssh-1', { environmentId: 'environment-1' }),
      startedAt: '2026-02-01T00:00:00.000Z',
      phase: 'destination-committed',
      sourceRetainedAt: '2026-02-01T00:00:00.000Z'
    })
    await expect(
      rollbackManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', code: 'octopod_rollback_crosses_migration' })
    expect(mocks.rollback).not.toHaveBeenCalled()
  })

  it('rolls back against the installed bytes of the previous slot', async () => {
    mocks.rollback.mockResolvedValueOnce({
      outcome: 'rolled-back',
      target: MANAGED_PREVIOUS_VERSION,
      discarded: [MANAGED_VERSION],
      verdict: { decision: 'activate', coverage: 'pty-spawn', warnings: [] }
    })
    await expect(
      rollbackManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'rolled-back', activeVersion: MANAGED_PREVIOUS_VERSION })
    expect(mocks.rollback.mock.calls[0]?.[0]).toMatchObject({ targetBuildHash: 'previous-hash' })
    expect(mocks.probe).toHaveBeenCalledWith(expect.anything(), {
      buildHash: 'previous-hash',
      fullVersion: MANAGED_PREVIOUS_VERSION
    })
    expect(mocks.rebuildTunnel).toHaveBeenCalledWith(harness.userDataPath, 'environment-1')
  })

  it('keeps the enrolled grant when the restored server offers a new device', async () => {
    mocks.rollback.mockResolvedValueOnce({
      outcome: 'rolled-back',
      target: MANAGED_PREVIOUS_VERSION,
      discarded: [MANAGED_VERSION],
      verdict: { decision: 'activate', coverage: 'pty-spawn', warnings: [] }
    })
    mocks.probe.mockResolvedValueOnce(managedReadiness('startup-offer-token'))
    await rollbackManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expectEnrolledPairing()
  })

  it('hands the rollback a recount that closes admission, and a reopen that only reopens it', async () => {
    mocks.rollback.mockResolvedValueOnce({ outcome: 'refused', code: 'x', reason: 'y' })
    await rollbackManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    const options = mocks.rollback.mock.calls[0]?.[0]
    // Initial census is unfenced; rollback must recount under lock.
    expect(mocks.census.mock.calls.map((call) => call[4]?.closeAdmissionForMs)).toEqual([undefined])
    await options.recountCensus()
    await options.releaseIncumbentAdmission()
    expect(mocks.census.mock.calls.map((call) => call[4])).toEqual([
      { releaseFinishedAutomationTerminals: true },
      {
        releaseFinishedAutomationTerminals: true,
        closeAdmissionForMs: OCTOPOD_UPDATE_ADMISSION_FENCE_MS
      },
      { closeAdmissionForMs: 0 }
    ])
  })
})

describe('recoverManagedOctopodEnvironment', () => {
  it('passes a refusal through and leaves the server linked', async () => {
    mocks.recover.mockResolvedValueOnce({
      outcome: 'refused',
      verdict: 'unverifiable',
      code: 'octopod_recovery_unverifiable',
      reason: 'host fenced'
    })
    await expect(
      recoverManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'refused', verdict: 'unverifiable' })
    expect(listEnvironments(harness.userDataPath)).toHaveLength(1)
  })

  it('forwards anew once a serving slot is restored, which may have bound another port', async () => {
    mocks.recover.mockResolvedValueOnce({
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: MANAGED_VERSION,
      readiness: managedReadiness()
    })
    await expect(
      recoverManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    ).resolves.toMatchObject({ outcome: 'recovered', activeVersion: MANAGED_VERSION })
    expect(mocks.rebuildTunnel).toHaveBeenCalledWith(harness.userDataPath, 'environment-1')
  })

  it('keeps the enrolled grant when the recovered server offers a new device', async () => {
    mocks.recover.mockResolvedValueOnce({
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: MANAGED_VERSION,
      readiness: managedReadiness('startup-offer-token')
    })
    await recoverManagedOctopodEnvironment(harness.userDataPath, { selector: 'Managed' })
    expectEnrolledPairing()
  })
})
