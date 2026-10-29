import type { EngineHttpEndpoint } from './engine-endpoints'

export type CalderaAbilitySummary = {
  abilityId: string
  name: string
  tactic?: string
  techniqueId?: string
}

export type CalderaOperationSummary = {
  operationId: string
  name: string
  state: 'running' | 'finished' | 'created'
}

export type CalderaAssaultResultSummary = {
  operationId: string
  linkId: string
  plutusOutput: string
  status: number
}

export type CalderaOperationRequest = {
  name: string
  adversaryId?: string
  abilityIds: readonly string[]
}

/** Caldera assault (UI 8890, API 18443) adapter contract; feeds SPAR signature Assault-Result capture. */
export interface CalderaAssaultAdapter {
  readonly api: EngineHttpEndpoint
  listAbilities(): Promise<readonly CalderaAbilitySummary[]>
  listOperations(): Promise<readonly CalderaOperationSummary[]>
  createOperation(request: CalderaOperationRequest): Promise<CalderaOperationSummary>
  readAssaultResults(operationId: string, limit: number): Promise<readonly CalderaAssaultResultSummary[]>
}
