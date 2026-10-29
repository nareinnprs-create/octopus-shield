import type { GanglionEdge, GanglionNodeId, TentacleName } from './tentacle'
import type { SubagentStatus } from './ganglion-subagent'

export type GanglionTentacleSpawnedEvent = {
  tentacle: TentacleName
  taskId: string
  title: string
  nodeId: GanglionNodeId
}

export type GanglionTaskQueuedEvent = {
  tentacle: TentacleName
  taskId: string
  title: string
  queueDepth: number
}

export type GanglionTaskCompletedEvent = {
  tentacle: TentacleName
  taskId: string
  /** null when delegation itself failed and the executor never reported a session. */
  sessionId: string | null
  nodeId: GanglionNodeId
  status: SubagentStatus
  detail?: string
  /** Delegation edge whose completion this event records. */
  edge: GanglionEdge
}

export type GanglionRuntimeEventMap = {
  'ganglion.tentacle.spawned': GanglionTentacleSpawnedEvent
  'ganglion.task.queued': GanglionTaskQueuedEvent
  'ganglion.task.completed': GanglionTaskCompletedEvent
}

export type GanglionRuntimeEventType = keyof GanglionRuntimeEventMap

/** Structural sink; the octopod event bus satisfies it once these keys are enrolled there. */
export type GanglionRuntimeEventSink = {
  publish<Type extends GanglionRuntimeEventType>(
    type: Type,
    payload: GanglionRuntimeEventMap[Type]
  ): void
}
