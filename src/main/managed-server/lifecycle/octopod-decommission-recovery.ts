import { writeOctopodActivationRecord } from '../activation/octopod-activation-record-store'
import type { OctopodActivationRecoveryResult } from '../activation/octopod-activation-recovery'
import type { OctopodDecommissionRecoveryPlan } from './octopod-decommission-transaction'
import { settleOctopodDecommissionStop } from './octopod-decommission-stop'
import {
  octopodLivenessProbeCommand,
  octopodLivenessProvenExited,
  parseOctopodLiveness
} from '../install/octopod-remote-launch'
import { execOctopodRemote } from '../install/octopod-remote-runtime-control'
import {
  ensureOctopodSlotServing,
  octopodSlotDir,
  resolveOctopodSlotIdentity,
  type OctopodSlotOptions
} from '../../ssh/octopod-recovery-slot'

/** Only proven exit clears an interrupted decommission journal. */
export async function reconcileOctopodDecommission(
  options: OctopodSlotOptions,
  plan: OctopodDecommissionRecoveryPlan
): Promise<OctopodActivationRecoveryResult> {
  if (plan.action === 'keep-serving') {
    const identity = await resolveOctopodSlotIdentity(options, plan.version)
    return {
      outcome: 'recovered',
      resolution: 'restored-incumbent',
      activeVersion: plan.version,
      readiness: await ensureOctopodSlotServing(options, identity)
    }
  }
  if (plan.action === 'resume-stop') {
    const settlement = await settleOctopodDecommissionStop(options, plan.request)
    if (settlement.state === 'unsettled') {
      return {
        outcome: 'refused',
        verdict: settlement.verdict,
        code: 'octopod_recovery_decommission_unsettled',
        reason: settlement.reason
      }
    }
    if (settlement.state === 'withdrawn') {
      return reconcileOctopodDecommission(options, {
        action: 'keep-serving',
        version: plan.request.version
      })
    }
    return reconcileOctopodDecommission(options, {
      action: 'confirm-decommissioned',
      version: plan.request.version,
      record: plan.record
    })
  }
  // Live or unanswered slots retain the fence; only proven exit permits commit.
  const liveness = parseOctopodLiveness(
    await execOctopodRemote(
      options,
      octopodLivenessProbeCommand(options.host, octopodSlotDir(options, plan.version))
    )
  )
  if (!octopodLivenessProvenExited(liveness)) {
    return {
      outcome: 'refused',
      verdict: liveness === 'LIVE' ? 'live' : 'unverifiable',
      code: 'octopod_recovery_decommissioned_slot_not_exited',
      reason: `octopod ${plan.version} is recorded as stopped but is ${liveness.toLowerCase()}.`
    }
  }
  if (plan.record) {
    await writeOctopodActivationRecord(options, plan.record)
  }
  return { outcome: 'recovered', resolution: 'committed', activeVersion: null, readiness: null }
}
