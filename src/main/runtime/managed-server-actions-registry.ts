/** Desktop main publishes managed-server actions for runtime RPC; headless hosts without a registry advertise none. */
import type {
  OctopodManagedPastLiveTerminals,
  OctopodManagedCancelStopResult,
  OctopodManagedDeployResult,
  OctopodManagedForgetResult,
  OctopodManagedRecoveryResult,
  OctopodManagedRollbackResult,
  OctopodManagedRuntimeStatus,
  OctopodManagedStopResult
} from '../../shared/octopod-managed-runtime'

export type ManagedServerActions = {
  status: (selector: string) => Promise<OctopodManagedRuntimeStatus>
  update: (
    selector: string,
    force: boolean,
    pastLiveTerminals?: OctopodManagedPastLiveTerminals
  ) => Promise<OctopodManagedDeployResult>
  rollback: (selector: string) => Promise<OctopodManagedRollbackResult>
  /** `acceptChangedState` restores the snapshot over state a rejected build changed. */
  recover: (selector: string, acceptChangedState?: boolean) => Promise<OctopodManagedRecoveryResult>
  stop: (selector: string) => Promise<OctopodManagedStopResult>
  cancelStop: (selector: string) => Promise<OctopodManagedCancelStopResult>
  forget: (selector: string) => Promise<OctopodManagedForgetResult>
}

let registered: ManagedServerActions | null = null

export function registerManagedServerActions(actions: ManagedServerActions | null): void {
  registered = actions
}

export function getManagedServerActions(): ManagedServerActions | null {
  return registered
}
