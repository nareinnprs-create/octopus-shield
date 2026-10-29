/** Reuse SSH update admission: keep newer, rolled-back or launch-rejected incumbents serving; fenced activation replans before committing. */
import {
  OCTOPOD_HOST_NEWER_DEFERRAL_CODE,
  type WslHostDeferredUpdate
} from '../../shared/wsl-host-types'
import { refuseOctopodHostDowngrade } from '../ssh/octopod-host-version-admission'
import type { ServeReadiness } from '../server/serve-readiness'
import type { OctopodActivationRecord } from '../managed-server/activation/octopod-activation-record'
import { readOctopodActivationRecord } from '../managed-server/activation/octopod-activation-record-store'
import { isWaitingOctopodUpdateDeferral } from '../managed-server/lifecycle/octopod-managed-auto-update'
import {
  octopodUpdateSkipRefusal,
  planOctopodUpdateForIntent,
  type ManagedOctopodAutoUpdatePlan,
  type OctopodUpdateIntent
} from '../managed-server/lifecycle/octopod-managed-update-decision'
import {
  octopodUpdateFailureThisLaunch,
  recordOctopodUpdateFailedThisLaunch,
  type OctopodUpdateFailure,
  type OctopodUpdateFailureHost
} from '../managed-server/lifecycle/octopod-managed-update-failure-memory'
import { OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE } from '../ssh/octopod-installed-activation'
import type { OctopodSlotOptions } from '../ssh/octopod-recovery-slot'
import { adoptRunningOctopodVersion } from '../ssh/octopod-running-version-adoption'
import type { WslOctopodLaunch } from './wsl-octopod-deploy'

type WslOctopodReadyLaunch = Extract<WslOctopodLaunch, { outcome: 'ready' }>

export type WslOctopodUpdateAdmission =
  | {
      action: 'serve'
      version: string
      readiness: ServeReadiness
      deferredUpdate: WslHostDeferredUpdate | null
    }
  /** Another run holds the host fence; a later connect adopts or deploys. */
  | { action: 'defer'; deferredUpdate: WslHostDeferredUpdate }
  /** Deploy this app's build on this record. */
  | { action: 'deploy'; record: OctopodActivationRecord }

export async function admitWslOctopodUpdate(args: {
  slot: OctopodSlotOptions
  record: OctopodActivationRecord
  candidateVersion: string
  appVersion: string
  host: OctopodUpdateFailureHost
  intent: OctopodUpdateIntent
}): Promise<WslOctopodUpdateAdmission> {
  const { record, candidateVersion, appVersion } = args
  if (!record.active) {
    return { action: 'deploy', record }
  }
  const failure = octopodUpdateFailureThisLaunch(args.host)
  const plan = planOctopodUpdateForIntent(args.intent, {
    record,
    candidateVersion,
    appVersion,
    failedBefore: failure !== null
  })
  if (plan.action !== 'skip' || plan.reason === 'current') {
    return { action: 'deploy', record }
  }
  const adopted = await adoptRunningOctopodVersion(args.slot, record, candidateVersion)
  if (!adopted) {
    // Nothing active any more: deploy on the record the wake read; its fenced admission re-plans.
    return { action: 'deploy', record: await readOctopodActivationRecord(args.slot) }
  }
  if ('outcome' in adopted) {
    const { candidateVersion: version, code, reason, forceable } = adopted
    return {
      action: 'defer',
      deferredUpdate: { candidateVersion: version, code, reason, forceable: forceable === true }
    }
  }
  return {
    action: 'serve',
    version: adopted.version,
    readiness: adopted.readiness,
    deferredUpdate:
      adopted.version === candidateVersion
        ? null
        : skippedUpdateHint(plan, failure, record, candidateVersion, appVersion)
  }
}

/** The launch an admission ends in, or the record to deploy on. */
export async function admitWslOctopodLaunch(
  args: Parameters<typeof admitWslOctopodUpdate>[0],
  distro: string,
  readyLaunch: (serving: {
    fullVersion: string
    readiness: ServeReadiness
  }) => Promise<WslOctopodReadyLaunch>
): Promise<WslOctopodLaunch | OctopodActivationRecord> {
  const admission = await admitWslOctopodUpdate(args)
  if (admission.action === 'deploy') {
    return admission.record
  }
  if (admission.action === 'defer') {
    return { outcome: 'deferred', distro, ...admission.deferredUpdate }
  }
  const ready = await readyLaunch({
    fullVersion: admission.version,
    readiness: admission.readiness
  })
  return admission.deferredUpdate ? { ...ready, deferredUpdate: admission.deferredUpdate } : ready
}

/** Offer Update/Force for retriable host deferrals; newer hosts get no hint because Update cannot change that refusal. */
function skippedUpdateHint(
  plan: ManagedOctopodAutoUpdatePlan,
  failure: OctopodUpdateFailure | null,
  record: OctopodActivationRecord,
  candidateVersion: string,
  appVersion: string
): WslHostDeferredUpdate | null {
  if (plan.action !== 'skip') {
    return null
  }
  if (plan.reason === 'failed-before' && failure) {
    return { candidateVersion, ...failure, forceable: true }
  }
  const refusal =
    plan.reason === 'rolled-back'
      ? octopodUpdateSkipRefusal(plan, record, candidateVersion, appVersion)
      : null
  return refusal
    ? {
        candidateVersion,
        code: OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE,
        reason: refusal,
        forceable: true
      }
    : null
}

/** Do not retry rejected/thrown incumbent updates this launch, matching SSH. Waits/policy refusals never attempted activation and record no failure. */
export function recordWslOctopodUpdateFailure(
  host: OctopodUpdateFailureHost,
  incumbentVersion: string | null,
  failure: OctopodUpdateFailure | null
): void {
  if (incumbentVersion && failure) {
    recordOctopodUpdateFailedThisLaunch(host, failure)
  }
}

export function wslOctopodDeferralFailure(deployed: {
  code: string
  reason: string
}): OctopodUpdateFailure | null {
  return isWaitingOctopodUpdateDeferral(deployed.code) ||
    deployed.code === OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE
    ? null
    : { code: deployed.code, reason: deployed.reason }
}

/** A policy refusal over a host a newer Shield runs gets its own code: an Update cannot pass it. */
export async function wslOctopodDeferralCode(
  slot: OctopodSlotOptions,
  deployed: { code: string; fullVersion: string },
  appVersion: string
): Promise<string> {
  if (deployed.code !== OCTOPOD_ACTIVATION_POLICY_REFUSED_CODE) {
    return deployed.code
  }
  const record = await readOctopodActivationRecord(slot).catch(() => null)
  return record && refuseOctopodHostDowngrade(record, deployed.fullVersion, appVersion)
    ? OCTOPOD_HOST_NEWER_DEFERRAL_CODE
    : deployed.code
}
