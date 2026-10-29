import { wakeStoppedManagedOctopod } from '../managed-server/lifecycle/octopod-managed-wake'
import type { OctopodSlotOptions } from './octopod-recovery-slot'

/** Already-active deploys launch nothing; wake that slot only on proven exit, including after reboot. Return whether it was started. */
export async function wakeAlreadyActiveOctopod(options: OctopodSlotOptions): Promise<boolean> {
  const wake = await wakeStoppedManagedOctopod(options)
  if (wake.outcome === 'recovery-refused') {
    throw new Error(wake.reason)
  }
  return wake.outcome === 'started'
}
