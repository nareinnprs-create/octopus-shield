import type {
  ArmoryHealthReport,
  ArmoryRunIpcRequest,
  ArmoryRunOutcome,
  ArmoryScopeState,
  ArmorySetupState,
  ArmoryToolView
} from '../../shared/armory-contract'

export type ArmoryApi = {
  list: () => Promise<readonly ArmoryToolView[]>
  scope: () => Promise<ArmoryScopeState>
  health: () => Promise<ArmoryHealthReport>
  setup: () => Promise<ArmorySetupState>
  run: (request: ArmoryRunIpcRequest) => Promise<ArmoryRunOutcome>
}
