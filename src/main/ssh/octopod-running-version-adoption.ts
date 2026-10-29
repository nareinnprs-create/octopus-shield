/** Pair with an already-running foreign build before considering update; an unpaired first deploy cannot census its terminals. */
import type { ServeReadiness } from '../server/serve-readiness'
import type { OctopodManagedDeferral } from '../../shared/octopod-managed-runtime'
import { octopodActivationFenceRefusal } from '../managed-server/activation/octopod-activation-fence-hold'
import { OctopodActiveReadinessError, probeActiveOctopodReadiness } from './octopod-active-readiness'
import type { OctopodActivationRecord } from '../managed-server/activation/octopod-activation-record'
import { readOctopodActivationRecord } from '../managed-server/activation/octopod-activation-record-store'
import { wakeStoppedManagedOctopod } from '../managed-server/lifecycle/octopod-managed-wake'
import { resolveOctopodSlotIdentity, type OctopodSlotOptions } from './octopod-recovery-slot'

export type OctopodRunningAdoption = {
  version: string
  readiness: ServeReadiness
  /** Reads the adopted slot's readiness again, e.g. after it rebinds its port. */
  reprobe: () => Promise<ServeReadiness>
}

/** No foreign activation returns null for normal deploy. A held peer fence defers: deploying without pairing would only fail census (#28833). */
export async function adoptRunningOctopodVersion(
  slot: OctopodSlotOptions,
  record: OctopodActivationRecord,
  localVersion: string,
  retryClearedFence = true
): Promise<OctopodRunningAdoption | OctopodManagedDeferral | null> {
  if (!record.active || record.active === localVersion) {
    return null
  }
  // Wake only on proven server exit; idle stops leave daemon terminals alive.
  const wake = await wakeStoppedManagedOctopod(slot)
  switch (wake.outcome) {
    // Another desktop stopped it meanwhile; the deploy's own gates decide.
    case 'not-activated':
      return null
    case 'fenced': {
      // E.g. another desktop starting it after a reboot; a later connect pairs with it.
      const { cleared, ...refusal } = await octopodActivationFenceRefusal(slot, 'server start')
      if (cleared && retryClearedFence) {
        return adoptRunningOctopodVersion(slot, record, localVersion, false)
      }
      return { outcome: 'deferred', candidateVersion: localVersion, ...refusal, forceable: false }
    }
    case 'unverifiable':
      throw new OctopodActiveReadinessError(
        'unverifiable',
        `Shield ${record.active} runs this host's server, but its process state is unverifiable, ` +
          'so it was left as it is. Try connecting again.'
      )
    case 'recovery-refused':
      throw new Error(wake.reason)
    case 'serving':
    case 'started':
      break
  }
  // Re-read activation because wake follows peer changes to the current record.
  const active = (await readOctopodActivationRecord(slot)).active
  if (!active || active === localVersion) {
    return null
  }
  const identity = await resolveOctopodSlotIdentity(slot, active)
  const reprobe = () =>
    probeActiveOctopodReadiness(
      { ...slot, remoteInstallDir: identity.remoteDir },
      { buildHash: identity.buildHash, fullVersion: identity.version }
    )
  return { version: active, readiness: await reprobe(), reprobe }
}
