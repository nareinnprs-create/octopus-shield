import type { EngineHttpEndpoint } from './engine-endpoints'

export type MythicCallbackSummary = {
  callbackId: string
  host: string
  user: string
  displayPayload?: string
  active: boolean
}

export type MythicTaskSummary = {
  taskId: string
  callbackId: string
  command: string
  status: 'submitted' | 'preprocessed' | 'completed' | 'error' | 'deferred'
}

export type MythicTaskInput = {
  callbackId: string
  command: string
  parameters: readonly string[]
}

/** Mythic C2 (Postgres 5436 / RabbitMQ 5672 internal) adapter contract; client implementation lives elsewhere. */
export interface MythicControllerAdapter {
  listCallbacks(): Promise<readonly MythicCallbackSummary[]>
  listTasksForCallback(callbackId: string, limit: number): Promise<readonly MythicTaskSummary[]>
  submitTask(input: MythicTaskInput): Promise<MythicTaskSummary>
}
