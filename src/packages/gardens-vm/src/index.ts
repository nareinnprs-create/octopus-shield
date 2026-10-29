export type {
  RunProcessLike,
  StartDetachedLike,
  VmBackend,
  VmBackendDiagnostics,
  VmBackendId,
  VmDiskSnapshot,
  VmHandle,
  VmInspectInfo,
  VmSpec,
  VmState,
  VmStopMode
} from './vm-backend'
export { imageRefIsRemote, validateVmSpec, vmNameLooksSafe, VM_NAME_PATTERN } from './vm-backend'
export {
  buildQemuImgCreateArgs,
  buildQemuImgSnapshotCreateArgs,
  buildQemuImgSnapshotListArgs,
  buildQemuImgSnapshotRollbackArgs,
  buildQemuSystemArgs,
  createQemuBackend,
  listGardenNamesFromDir,
  mergeQemuVmMetadata,
  parseQemuImgSnapshotList,
  qemuImgSiblingPath,
  qemuSizeToBytes,
  qemuSnapshotIdLooksSafe,
  qemuSystemCandidates,
  snapshotListHasName,
  QEMU_SNAPSHOT_ID_PATTERN,
  type QemuBackend,
  type QemuBackendDeps,
  type QemuLaunchPlan,
  type QemuVmMetadata
} from './vm-backend-qemu'
export {
  buildHyperVCheckpointScript,
  buildHyperVNewVmScript,
  buildHyperVRemoveScript,
  buildHyperVStartScript,
  buildHyperVStateScript,
  buildHyperVStopScript,
  createHyperVBackend,
  hyperVVhdPath,
  hypervAvailabilityScript,
  type HyperVBackend
} from './vm-backend-hyperv'
export { createVzBackend, type VzBackend } from './vm-backend-vz'
export {
  downloadVmImage,
  sha256Hex,
  vmImageById,
  VM_IMAGE_CATALOG,
  type VmImageEntry,
  type VmImageId
} from './vm-images'
export {
  GARDENS_DIR_ENV,
  GARDENS_SCOPE_ENV,
  GardensVmManager,
  gardensVmDirFromEnv,
  parseGardensScope,
  scopeFromEnv,
  scopeRefusalReason,
  vmNameInScope,
  gardensVmAuditEvent,
  runAuditedLifecycleOp,
  type GardensScope,
  type GardensVmAuditEvent,
  type GardensVmLifecycleRecord,
  type GardensVmListEntry,
  type GardensVmOpResult
} from './gardens-vm'
export {
  createBackendSelector,
  probeAvailability,
  type BackendSelector,
  type BackendVerdict
} from './gardens-vm-backends'
export type { QemuBinLocator, QemuSnapshotOps, QemuSnapshotOpsDeps } from './qemu-snapshot-ops'
export { createQemuSnapshotOps } from './qemu-snapshot-ops'
export {
  formatVmInspection,
  parseGardensVmCommand,
  runGardensVmCli,
  type GardensVmCliOptions
} from './gardens-vm-cli'
