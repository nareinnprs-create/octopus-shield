import type {
  ArmoryHealthReport,
  ArmoryRunIpcRequest,
  ArmoryRunOutcome,
  ArmoryScopeState,
  ArmoryToolView
} from '../../shared/armory-contract'

export type ArmoryApi = {
  list: () => Promise<readonly ArmoryToolView[]>
  scope: () => Promise<ArmoryScopeState>
  health: () => Promise<ArmoryHealthReport>
  run: (request: ArmoryRunIpcRequest) => Promise<ArmoryRunOutcome>
}
