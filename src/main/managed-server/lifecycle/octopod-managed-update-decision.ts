import { compareAppVersions, isValidAppVersion } from '../../../shared/app-version'
import type { OctopodActivationRecord } from '../activation/octopod-activation-record'
import {
  refuseOctopodHostDowngrade,
  type OctopodHostVersionRefusal
} from '../../ssh/octopod-host-version-admission'

export type ManagedOctopodAutoUpdateSkip =
  | 'current'
  | 'no-template'
  | 'rolled-back'
  | 'failed-before'
  | 'migrating'
  | OctopodHostVersionRefusal

/** Connect honors all skips; Update retries local failures/rollbacks; Force also lifts version skips. */
export type OctopodUpdateIntent = 'connect' | 'update' | 'force'

export type ManagedOctopodAutoUpdatePlan =
  | { action: 'update' }
  | { action: 'skip'; reason: ManagedOctopodAutoUpdateSkip }

export function planManagedOctopodAutoUpdate(input: {
  record: OctopodActivationRecord
  candidateVersion: string | null
  appVersion: string
  failedBefore: boolean
}): ManagedOctopodAutoUpdatePlan {
  const { record, candidateVersion } = input
  if (!candidateVersion) {
    return { action: 'skip', reason: 'no-template' }
  }
  if (record.active === candidateVersion) {
    return { action: 'skip', reason: 'current' }
  }
  if (record.rolledBackFrom === candidateVersion) {
    return { action: 'skip', reason: 'rolled-back' }
  }
  const refusal = refuseOctopodHostDowngrade(record, candidateVersion, input.appVersion)
  if (refusal) {
    return { action: 'skip', reason: refusal }
  }
  // A stopped host has no serving fallback; retry even after a prior failed attempt.
  if (record.active === null && record.previous !== null) {
    return { action: 'update' }
  }
  return input.failedBefore ? { action: 'skip', reason: 'failed-before' } : { action: 'update' }
}

export function planOctopodUpdateForIntent(
  intent: OctopodUpdateIntent,
  input: Parameters<typeof planManagedOctopodAutoUpdate>[0]
): ManagedOctopodAutoUpdatePlan {
  if (intent === 'force') {
    return { action: 'update' }
  }
  if (intent === 'connect') {
    return planManagedOctopodAutoUpdate(input)
  }
  const { rolledBackFrom: _retried, ...record } = input.record
  return planManagedOctopodAutoUpdate({ ...input, record, failedBefore: false })
}

export function admitOctopodRecordForIntent(
  intent: OctopodUpdateIntent,
  appVersion: string
): (record: OctopodActivationRecord, candidateVersion: string) => string | null {
  return (record, candidateVersion) =>
    octopodUpdateSkipRefusal(
      planOctopodUpdateForIntent(intent, {
        record,
        candidateVersion,
        appVersion,
        failedBefore: false
      }),
      record,
      candidateVersion,
      appVersion
    )
}

export function octopodUpdateSkipRefusal(
  plan: ManagedOctopodAutoUpdatePlan,
  record: OctopodActivationRecord,
  candidateVersion: string,
  appVersion: string
): string | null {
  if (plan.action !== 'skip' || plan.reason === 'current') {
    return null
  }
  return plan.reason === 'rolled-back'
    ? `This host's server rolled back from ${candidateVersion}, so a connect does not activate ` +
        'it again; choose Update or Force to retry it.'
    : `Shield ${record.activeAppVersion} last ran this host's server, newer than this ` +
        `Shield (${appVersion}). Update Shield to start it.`
}

/** Content hashes cannot order updates: compare Shield versions, or for legacy hosts offer only this desktop's previously deferred build. */
export function availableManagedOctopodUpdate(input: {
  record: OctopodActivationRecord
  candidateVersion: string | null
  appVersion: string
  /** The build this desktop's last Update or connect deferred on this host. */
  deferredCandidateVersion: string | null
}): string | null {
  const { record, candidateVersion, appVersion } = input
  const hostAppVersion = record.activeAppVersion
  if (!candidateVersion || record.active === null || !isValidAppVersion(appVersion)) {
    return null
  }
  const ordered = hostAppVersion
    ? isValidAppVersion(hostAppVersion) && compareAppVersions(appVersion, hostAppVersion) >= 0
    : input.deferredCandidateVersion === candidateVersion
  if (!ordered) {
    return null
  }
  // Connect rules: a build the user rolled back from is not advertised again.
  const plan = planManagedOctopodAutoUpdate({
    record,
    candidateVersion,
    appVersion,
    failedBefore: false
  })
  return plan.action === 'update' ? candidateVersion : null
}
