import type { AuditEvent } from '@shield/access/audit-chain'
import type { ArmoryRunRecord } from './tool-runner'

/** Every Armory run becomes one audit-chain event (actor_kind='tentacle'). */
export const armoryRunAuditEvent = (record: ArmoryRunRecord): AuditEvent => ({
  tsEpochMs: Date.now(),
  actorKind: 'tentacle',
  actorId: 'armory',
  action: 'armory.run',
  resourceKind: 'armory-tool',
  resourceId: record.toolId,
  traceId: null,
  payload: {
    argv: record.argv,
    targets: record.targets,
    exitCode: record.exitCode,
    timedOut: record.timedOut,
    durationMs: record.durationMs
  }
})
