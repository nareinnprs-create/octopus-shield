import type { ShieldRuntimeService } from '../shield-runtime'

export type WorkerTerminalReleaseRuntime = Pick<
  ShieldRuntimeService,
  | 'retireStructuredAgentSessionTabFromSnapshot'
  | 'forgetStructuredSessionMail'
  | 'resolveOrchestrationWorkerServer'
  | 'callOrchestrationWorkerServer'
  | 'getOrchestrationFleetAgentStatusSnapshot'
  | 'getOrchestrationDb'
  | 'showTerminal'
  | 'resolveTerminalHandleByProcessIncarnation'
  | 'getTerminalPaneKey'
  | 'getTerminalProcessIncarnation'
  | 'getTerminalLivenessVerdict'
  | 'checkTerminalAgentPresence'
  | 'getOrchestrationDispatchAuthority'
  | 'ensureStructuredAgentSessionHost'
  | 'inspectTerminalProcessIncarnationLiveness'
  | 'closeTerminal'
  | 'getExactWorkerProviderSession'
  | 'readTerminal'
  | 'notifyMessageArrived'
>
