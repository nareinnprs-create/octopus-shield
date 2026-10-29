// Rollback restores a pre-activation snapshot: older builds may not understand newer state.
// Stop, rescue, restore, then launch; the rescue and fenced journal allow recovery of interrupted steps.
import { logOctopodActivationOutcome } from '../activation/octopod-activation-outcome-log'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'
import type { OctopodActivationRecord } from '../activation/octopod-activation-record'
import type { OctopodTerminalCensus } from '../../../shared/octopod-terminal-census'
import type { OctopodActivationVerdict } from '../activation/octopod-activation-gate'
import type { OctopodDaemonProtocolFacts } from '../../ssh/octopod-daemon-protocol-crossing'
import { readOctopodActivationRecord } from '../activation/octopod-activation-record-store'
import { sameOctopodActivationRecord } from '../activation/octopod-activation-transaction'
import type { RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  resolveOctopodActivationReadinessTimeout,
  withOctopodActivationLock
} from '../activation/octopod-activation-lock'
import { octopodActivationFenceRefusal } from '../activation/octopod-activation-fence-hold'
import { OCTOPOD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/octopod-profile-preflight'
import { rollbackOctopodLocked } from '../lifecycle/octopod-rollback-transition'

export type OctopodRollbackOptions = {
  conn: OctopodHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  record: OctopodActivationRecord
  nodePath: string
  userDataDir: string
  bindHost: string
  port: number
  census: OctopodTerminalCensus
  /** Close terminal admission, then recount under the host lock; any failure is unverifiable. */
  recountCensus: () => Promise<OctopodTerminalCensus>
  /** Reopen admission if rollback leaves the incumbent serving. */
  releaseIncumbentAdmission: () => Promise<void>
  /** Expected hash from the client's copy of the rollback target. */
  targetBuildHash: string
  /** Protocol facts from the same target bytes. */
  targetDaemonProtocol: OctopodDaemonProtocolFacts
  readinessTimeoutMs?: number
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

export type OctopodRollbackResult =
  | { outcome: 'rolled-back'; target: string; discarded: string[]; verdict: OctopodActivationVerdict }
  | { outcome: 'refused'; code: string; reason: string }
  | { outcome: 'failed'; code: string; reason: string }

export async function rollbackOctopod(input: OctopodRollbackOptions): Promise<OctopodRollbackResult> {
  const options = {
    ...input,
    readinessTimeoutMs: resolveOctopodActivationReadinessTimeout(
      input.readinessTimeoutMs,
      OCTOPOD_STARTUP_READINESS_TIMEOUT_MS
    )
  }
  return logOctopodActivationOutcome(
    `rollback to ${options.record.previous ?? 'none'}`,
    () =>
      withOctopodActivationLock(
        options,
        async (lock) => {
          if (
            !sameOctopodActivationRecord(await readOctopodActivationRecord(options), options.record)
          ) {
            return {
              outcome: 'refused',
              code: 'octopod_rollback_record_changed',
              reason:
                'The host activation record changed while this rollback was waiting. Refresh the ' +
                'host state and review the new rollback target before trying again.'
            }
          }
          return rollbackOctopodLocked(options, lock)
        },
        async () => {
          const { code, reason } = await octopodActivationFenceRefusal(options, 'rollback')
          return { outcome: 'refused', code, reason }
        }
      ),
    ['rolled-back']
  )
}
