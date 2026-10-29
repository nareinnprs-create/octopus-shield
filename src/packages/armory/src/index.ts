export type {
  ArmoryCategory,
  ArmoryRuntime,
  ArmoryScopeClass,
  ArmoryToolDescriptor
} from './tool-registry'
export {
  parseArmoryScope,
  scopeFromEnv,
  targetInScope,
  targetsInScope,
  type ArmoryScope
} from './tool-scope'
export {
  runArmoryTool,
  type ArmoryRunDenied,
  type ArmoryRunRecord,
  type ArmoryRunRequest,
  type ArmoryRunResult
} from './tool-runner'
export { armoryRunAuditEvent } from './armory-audit'
export { createPostgresAuditSink, type PostgresAuditSinkOptions } from '@shield/audit-store'
export {
  armoryInventoryDir,
  defaultInventoryPaths,
  descriptorsFromInventories,
  loadToolInventory,
  type ArmoryInventoryEntry
} from './inventory'
