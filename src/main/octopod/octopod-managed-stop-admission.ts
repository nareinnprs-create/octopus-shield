import type { OctopodManagedStopRequest } from '../../shared/octopod-stop-request'
import { persistOctopodDaemonRetirementRecord } from './octopod-completed-stop-receipt'
import type { OctopodDaemonRetirement } from './octopod-daemon-retirement'
import { stopOctopodAutomationScheduler } from './octopod-automations'
import { holdOctopodTerminalAdmissionUntilExit } from './octopod-stop-terminal-admission'

// Keep daemon imports lazy so entry loading cannot initialize native code.
async function retireLazily(): Promise<OctopodDaemonRetirement> {
  const { retireOctopodDaemonIfIdle } = await import('./octopod-daemon-retirement')
  return retireOctopodDaemonIfIdle()
}

/** Record managed-stop outcomes without vetoing the stop. */
export async function prepareOctopodManagedStop(
  request: OctopodManagedStopRequest,
  retire: () => Promise<OctopodDaemonRetirement> = retireLazily,
  stopAutomations: () => void = stopOctopodAutomationScheduler,
  holdTerminalAdmission: () => void = holdOctopodTerminalAdmissionUntilExit
): Promise<void> {
  // Fence spawns before potentially slow daemon retirement.
  holdTerminalAdmission()
  // Stop dispatch before census so new runs cannot race shutdown.
  stopAutomations()
  if (!request.retireIdleDaemon) {
    return
  }
  const outcome = await retire().catch((error: unknown): OctopodDaemonRetirement => ({
    retirement: 'unverifiable',
    liveSessions: null,
    reason: `Retirement failed: ${error instanceof Error ? error.message : String(error)}`
  }))
  try {
    persistOctopodDaemonRetirementRecord(request, outcome)
  } catch (error) {
    // Missing retirement records remain unverifiable to the completion reader.
    console.error('[octopod] could not record daemon retirement:', error)
  }
}
