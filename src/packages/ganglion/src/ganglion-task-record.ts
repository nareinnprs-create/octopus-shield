import type { GanglionRegistry } from './ganglion-registry'
import type { GanglionRuntimeAuditEvent } from './ganglion-runtime-audit'
import type { GanglionEdge, GanglionNodeId, TentacleName } from './tentacle'
import type { SubagentStatus } from './ganglion-subagent'

export type GanglionTaskState = 'queued' | 'running' | 'completed' | 'failed'

export type GanglionTaskRecord = {
  taskId: string
  tentacle: TentacleName
  title: string
  nodeId: GanglionNodeId
  /** Delegation edge reserved at spawn: primary Tentacle node -> task node. */
  edge: GanglionEdge
  state: GanglionTaskState
  sessionId?: string
  status?: SubagentStatus
  detail?: string
  createdAtEpochMs: number
  startedAtEpochMs?: number
  completedAtEpochMs?: number
  audited: true
}

export type GanglionRuntimeSnapshot = {
  registry: GanglionRegistry
  tasks: readonly GanglionTaskRecord[]
  queueDepthByTentacle: Readonly<Record<string, number>>
  runningCountByTentacle: Readonly<Record<string, number>>
  audit: readonly GanglionRuntimeAuditEvent[]
}

/** Per-Tentacle queue/running tallies over the task ledger. */
export const ganglionTaskCountersByTentacle = (
  tasks: readonly GanglionTaskRecord[]
): {
  queueDepthByTentacle: Record<string, number>
  runningCountByTentacle: Record<string, number>
} => {
  const queueDepthByTentacle: Record<string, number> = {}
  const runningCountByTentacle: Record<string, number> = {}
  for (const record of tasks) {
    if (record.state === 'queued') {
      queueDepthByTentacle[record.tentacle] = (queueDepthByTentacle[record.tentacle] ?? 0) + 1
    }
    if (record.state === 'running') {
      runningCountByTentacle[record.tentacle] = (runningCountByTentacle[record.tentacle] ?? 0) + 1
    }
  }
  return { queueDepthByTentacle, runningCountByTentacle }
}
