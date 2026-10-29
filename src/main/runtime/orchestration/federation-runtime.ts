import type { ShieldRuntimeService } from '../shield-runtime'

export type FederationRuntime = Pick<
  ShieldRuntimeService,
  | 'syncOrchestrationFederatedDispatch'
  | 'getOrchestrationDb'
  | 'resolveOrchestrationWorkerServer'
  | 'callOrchestrationWorkerServer'
  | 'notifyMessageArrived'
  | 'reconcileLegacyWorkerTerminals'
>
