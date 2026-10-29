/** Same shape as @shield/gardens-vm audit events (actor_kind='tentacle'). */
export type GanglionRuntimeAuditEvent = {
  tsEpochMs: number
  actorKind: 'tentacle'
  actorId: 'ganglion-runtime'
  action: 'ganglion.task.spawned' | 'ganglion.task.queued' | 'ganglion.task.completed'
  resourceKind: 'ganglion-task'
  resourceId: string
  traceId: null
  payload: Record<string, unknown>
}

export const ganglionRuntimeAuditEvent = (
  action: GanglionRuntimeAuditEvent['action'],
  resourceId: string,
  tsEpochMs: number,
  payload: Record<string, unknown>
): GanglionRuntimeAuditEvent => ({
  tsEpochMs,
  actorKind: 'tentacle',
  actorId: 'ganglion-runtime',
  action,
  resourceKind: 'ganglion-task',
  resourceId,
  traceId: null,
  payload
})
