/** Reject activation over state a newer host build may already have migrated. */
import { compareAppVersions } from '../../shared/app-version'
import type { OctopodActivationRecord } from '../managed-server/activation/octopod-activation-record'

export type OctopodHostVersionRefusal = 'host-newer'

export function refuseOctopodHostDowngrade(
  record: OctopodActivationRecord,
  candidateVersion: string,
  appVersion: string
): OctopodHostVersionRefusal | null {
  // Restarting the stopped build cannot downgrade state.
  if (record.active === null && record.previous === candidateVersion) {
    return null
  }
  // Older Stop records omit app version; refuse only proven newer hosts or they would be stranded.
  if (!record.activeAppVersion) {
    return null
  }
  return compareAppVersions(record.activeAppVersion, appVersion) > 0 ? 'host-newer' : null
}
