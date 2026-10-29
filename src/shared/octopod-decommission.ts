import type { OctopodManagedRefusal } from './octopod-managed-runtime'
import type { OctopodDaemonRetirementVerdict } from './octopod-stop-request'

export type OctopodDecommissionResult =
  | {
      outcome: 'decommissioned'
      version: string
      /** The daemon's fate: `retired`, or kept with its terminals (`live`/`unverifiable`). */
      retirement: OctopodDaemonRetirementVerdict
    }
  | OctopodManagedRefusal
