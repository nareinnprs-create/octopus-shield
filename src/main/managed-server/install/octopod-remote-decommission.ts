// Journal instance-bound stop under the activation fence; refuse live/unknown terminal census and deactivate only after proven exit.
import { randomUUID } from 'node:crypto'
import type { OctopodActivationRecord } from '../activation/octopod-activation-record'
import {
  readOctopodActivationRecord,
  writeOctopodActivationRecord
} from '../activation/octopod-activation-record-store'
import { sameOctopodActivationRecord } from '../activation/octopod-activation-transaction'
import { writeOctopodActivationTransaction } from '../activation/octopod-activation-transaction-store'
import { withOctopodActivationLock } from '../activation/octopod-activation-lock'
import { octopodActivationFenceRefusal } from '../activation/octopod-activation-fence-hold'
import {
  committedOctopodDecommissionRecord,
  createOctopodDecommissionTransaction,
  withOctopodDecommissionProcessExited,
  withOctopodDecommissionStopDispatched
} from '../lifecycle/octopod-decommission-transaction'
import { readRemoteOctopodManagedStopTarget } from '../lifecycle/octopod-managed-remote-stop'
import { settleOctopodDecommissionStop } from '../lifecycle/octopod-decommission-stop'
import type { OctopodSlotOptions } from '../../ssh/octopod-recovery-slot'
import type { OctopodDecommissionResult } from '../../../shared/octopod-decommission'
import type { OctopodTerminalCensus } from '../../../shared/octopod-terminal-census'

type OctopodDecommissionOptions = OctopodSlotOptions & {
  /** Refuse if the host record changed since caller review. */
  record: OctopodActivationRecord
  /** Fresh census must prove no live or uncounted terminals. */
  census: OctopodTerminalCensus
  now?: () => Date
}

type Refusal = Extract<OctopodDecommissionResult, { outcome: 'refused' }>

function refuse(verdict: Refusal['verdict'], code: string, reason: string): Refusal {
  return { outcome: 'refused', verdict, code, reason }
}

function censusRefusal(census: OctopodTerminalCensus): Refusal | null {
  if (census.liveSessions === null) {
    return refuse(
      'unverifiable',
      'octopod_decommission_census_unavailable',
      'The terminal daemon did not answer a session count, so decommissioning could end ' +
        'running work. Retry when the host answers.'
    )
  }
  if (census.liveSessions > 0) {
    return refuse(
      'live',
      'octopod_decommission_terminals_running',
      `${census.liveSessions} terminal${census.liveSessions === 1 ? ' is' : 's are'} still ` +
        'running on this host. Close them before decommissioning the server.'
    )
  }
  return null
}

export async function decommissionRemoteOctopod(
  options: OctopodDecommissionOptions
): Promise<OctopodDecommissionResult> {
  const now = options.now ?? ((): Date => new Date())
  return withOctopodActivationLock(
    options,
    async (lock) => {
      const record = await readOctopodActivationRecord(options)
      if (!sameOctopodActivationRecord(record, options.record)) {
        return refuse(
          'unverifiable',
          'octopod_decommission_record_changed',
          'The host activation record changed since it was reviewed. Refresh and try again.'
        )
      }
      const activeVersion = record.active
      if (!activeVersion) {
        return refuse(
          'unverifiable',
          'octopod_decommission_nothing_active',
          'No octopod version is active on this host, so there is nothing to decommission.'
        )
      }
      const census = censusRefusal(options.census)
      if (census) {
        return census
      }
      const target = await readRemoteOctopodManagedStopTarget(options, activeVersion)
      if (target.state === 'refused') {
        return refuse(target.verdict, target.code, target.reason)
      }

      let transaction = createOctopodDecommissionTransaction({
        transactionId: randomUUID(),
        recordBefore: { ...record, active: activeVersion },
        now: now()
      })
      await writeOctopodActivationTransaction(options, transaction)
      lock.retainOnError()
      const request = {
        schemaVersion: 1 as const,
        transactionId: transaction.transactionId,
        ...target.context,
        // Idle daemon retirement is best-effort; busy daemons retain their terminals.
        retireIdleDaemon: true as const
      }
      // Journal exact stop intent before dispatch so recovery can settle the same request.
      transaction = withOctopodDecommissionStopDispatched(transaction, request, now())
      await writeOctopodActivationTransaction(options, transaction)

      const settlement = await settleOctopodDecommissionStop(options, request)
      if (settlement.state === 'withdrawn') {
        return refuse(settlement.verdict, 'octopod_decommission_stop_withdrawn', settlement.reason)
      }
      if (settlement.state === 'unsettled') {
        lock.retain()
        return refuse(settlement.verdict, 'octopod_decommission_stop_unsettled', settlement.reason)
      }
      transaction = withOctopodDecommissionProcessExited(transaction, now())
      await writeOctopodActivationTransaction(options, transaction)
      await writeOctopodActivationRecord(options, committedOctopodDecommissionRecord(transaction))
      return {
        outcome: 'decommissioned',
        version: activeVersion,
        retirement: settlement.retirement
      }
    },
    async () => {
      const refusal = await octopodActivationFenceRefusal(options, 'stop')
      return refuse('unverifiable', refusal.code, refusal.reason)
    }
  )
}
