import type { OctopodManagedDeferral } from '../../../shared/octopod-managed-runtime'
import { compareAppVersions } from '../../../shared/app-version'

type RecordedDeferral = OctopodManagedDeferral & { deferredAt: string }

const deferrals = new Map<string, RecordedDeferral>()

export function recordManagedOctopodUpdateDeferral(
  environmentId: string,
  deferral: OctopodManagedDeferral,
  now = new Date()
): void {
  deferrals.set(environmentId, { ...deferral, deferredAt: now.toISOString() })
}

export function clearManagedOctopodUpdateDeferral(environmentId: string): void {
  deferrals.delete(environmentId)
}

function readManagedOctopodUpdateDeferral(environmentId: string): RecordedDeferral | null {
  return deferrals.get(environmentId) ?? null
}

/** Forget deferrals resolved by another desktop activating the candidate or a newer release. */
export function currentManagedOctopodUpdateDeferral(
  environmentId: string,
  activeVersion: string | null
): RecordedDeferral | null {
  const deferral = readManagedOctopodUpdateDeferral(environmentId)
  if (
    deferral &&
    activeVersion &&
    (activeVersion === deferral.candidateVersion ||
      compareAppVersions(activeVersion, deferral.candidateVersion) > 0)
  ) {
    clearManagedOctopodUpdateDeferral(environmentId)
    return null
  }
  return deferral
}
