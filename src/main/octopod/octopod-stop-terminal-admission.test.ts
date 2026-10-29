import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalUpdateAdmission } from '../runtime/terminal/stop/terminal-update-admission'
import type { installOctopodShutdownSignals } from './octopod-lifecycle'
import type { prepareOctopodManagedStop } from './octopod-managed-stop-admission'
import type * as Holder from './octopod-stop-terminal-admission'

// Reset process-wide stop state between tests.
let stops: {
  installOctopodShutdownSignals: typeof installOctopodShutdownSignals
  prepareOctopodManagedStop: typeof prepareOctopodManagedStop
  holder: typeof Holder
}
beforeEach(async () => {
  vi.resetModules()
  stops = {
    installOctopodShutdownSignals: (await import('./octopod-lifecycle')).installOctopodShutdownSignals,
    prepareOctopodManagedStop: (await import('./octopod-managed-stop-admission'))
      .prepareOctopodManagedStop,
    holder: await import('./octopod-stop-terminal-admission')
  }
})

let now = 1_000
let admission = new TerminalUpdateAdmission(
  async () => [],
  () => now
)

function freshAdmission(): TerminalUpdateAdmission {
  now = 1_000
  admission = new TerminalUpdateAdmission(
    async () => [],
    () => now
  )
  stops.holder.bindOctopodStopTerminalAdmission(admission)
  return admission
}

function expectHeldPastEveryReopen(): void {
  admission.close(0)
  expect(admission.isClosed()).toBe(true)
  admission.close(60_000)
  now += 61_000
  expect(admission.isClosed()).toBe(true)
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('octopod stop terminal admission', () => {
  it('closes admission when a managed stop begins, before anything else it prepares', async () => {
    freshAdmission()
    let closedFirst = false
    await stops.prepareOctopodManagedStop(
      {
        schemaVersion: 1,
        transactionId: 't',
        version: '1.0.0',
        runtimeId: 'r',
        instance: { pid: 1, startedAtMs: null, nonce: 'n', lockPath: '/tmp/octopod.lock' }
      },
      async () => ({ retirement: 'retired', liveSessions: 0, reason: null }),
      () => {
        closedFirst = admission.isClosed()
      }
    )

    expect(closedFirst).toBe(true)
    expectHeldPastEveryReopen()
  })

  it('closes admission when any shutdown begins, before the runtime stops', () => {
    vi.useFakeTimers()
    vi.spyOn(process, 'on').mockImplementation(() => process)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    freshAdmission()
    let closedAtStop = false
    const shutdown = stops.installOctopodShutdownSignals(async () => {
      closedAtStop = admission.isClosed()
      return new Promise<void>(() => {})
    })

    expect(shutdown('idle')).toBe(true)
    expect(closedAtStop).toBe(true)
    expectHeldPastEveryReopen()
  })

  it('holds admission for a stop that began before the runtime bound it', () => {
    stops.holder.holdOctopodTerminalAdmissionUntilExit()
    freshAdmission()
    expectHeldPastEveryReopen()
  })
})
