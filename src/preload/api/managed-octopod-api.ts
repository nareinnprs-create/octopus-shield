/** Managed octopod servers over SSH; desktop-only, so web clients leave it undefined. */
import { ipcRenderer } from 'electron'
import type {
  OctopodDeltaMovePreview,
  OctopodDeltaMoveResult,
  OctopodManagedCancelStopResult,
  OctopodManagedConversionResult,
  OctopodManagedDeployResult,
  OctopodManagedForgetResult,
  OctopodManagedPastLiveTerminals,
  OctopodManagedPendingMigrationRow,
  OctopodManagedRecoveryResult,
  OctopodManagedRestartResult,
  OctopodManagedStaleLockReclaimRequest,
  OctopodManagedStaleLockReclaimResult,
  OctopodManagedRollbackResult,
  OctopodManagedRuntimeStatus,
  OctopodManagedStopResult
} from '../../shared/octopod-managed-runtime'
import type { PublicKnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type {
  RuntimeSshAccessLinkRequest,
  RuntimeSshAccessUnlinkRequest
} from '../../shared/runtime-ssh-access'

export type ManagedOctopodPreloadApi = {
  deploy: (args: {
    name: string
    sshTargetId: string
    force?: boolean
  }) => Promise<OctopodManagedDeployResult>
  getStatus: (args: { selector: string }) => Promise<OctopodManagedRuntimeStatus>
  update: (args: {
    selector: string
    force?: boolean
    pastLiveTerminals?: OctopodManagedPastLiveTerminals
  }) => Promise<OctopodManagedDeployResult>
  rollback: (args: { selector: string }) => Promise<OctopodManagedRollbackResult>
  recover: (args: {
    selector: string
    /** Restore the snapshot over state a rejected build changed; see OCTOPOD_RECOVERY_CHANGED_STATE_CODE. */
    acceptChangedState?: boolean
  }) => Promise<OctopodManagedRecoveryResult>
  /** Restarts from this client's SSH session; refused while terminals run. */
  restart: (args: { selector: string }) => Promise<OctopodManagedRestartResult>
  /** Without `yes`, only reports whether the host's instance lock may be cleared. */
  reclaimStaleLock: (
    args: { selector: string } & OctopodManagedStaleLockReclaimRequest
  ) => Promise<OctopodManagedStaleLockReclaimResult>
  stop: (args: { selector: string }) => Promise<OctopodManagedStopResult>
  cancelStop: (args: { selector: string }) => Promise<OctopodManagedCancelStopResult>
  forget: (args: { selector: string }) => Promise<OctopodManagedForgetResult>
  linkSshAccess: (args: RuntimeSshAccessLinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  unlinkSshAccess: (args: RuntimeSshAccessUnlinkRequest) => Promise<PublicKnownRuntimeEnvironment>
  convertSshHost: (args: {
    sshTargetId: string
    name: string
  }) => Promise<OctopodManagedConversionResult>
  listPendingMigrations: () => Promise<OctopodManagedPendingMigrationRow[]>
  previewDeltaMove: (args: { sshTargetId: string }) => Promise<OctopodDeltaMovePreview>
  moveDelta: (args: { sshTargetId: string }) => Promise<OctopodDeltaMoveResult>
  keepServerVersion: (args: { sshTargetId: string }) => Promise<void>
  /** "Move anyway": the next connect leaves what can't move on this desktop. */
  allowMoveLeavingBehind: (args: { sshTargetId: string }) => Promise<void>
}

export const managedOctopodApi: ManagedOctopodPreloadApi = {
  deploy: (args) => ipcRenderer.invoke('runtimeEnvironments:deployOctopod', args),
  getStatus: (args) => ipcRenderer.invoke('runtimeEnvironments:getOctopodStatus', args),
  update: (args) => ipcRenderer.invoke('runtimeEnvironments:updateOctopod', args),
  rollback: (args) => ipcRenderer.invoke('runtimeEnvironments:rollbackOctopod', args),
  recover: (args) => ipcRenderer.invoke('runtimeEnvironments:recoverOctopod', args),
  restart: (args) => ipcRenderer.invoke('runtimeEnvironments:restartOctopod', args),
  reclaimStaleLock: (args) => ipcRenderer.invoke('runtimeEnvironments:reclaimOctopodStaleLock', args),
  stop: (args) => ipcRenderer.invoke('runtimeEnvironments:stopOctopod', args),
  cancelStop: (args) => ipcRenderer.invoke('runtimeEnvironments:cancelOctopodStop', args),
  forget: (args) => ipcRenderer.invoke('runtimeEnvironments:forgetOctopod', args),
  linkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:linkSshAccess', args),
  unlinkSshAccess: (args) => ipcRenderer.invoke('runtimeEnvironments:unlinkSshAccess', args),
  convertSshHost: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:convertSshHostToManagedOctopod', args),
  listPendingMigrations: () => ipcRenderer.invoke('runtimeEnvironments:listPendingOctopodMigrations'),
  previewDeltaMove: (args) => ipcRenderer.invoke('runtimeEnvironments:previewOctopodDeltaMove', args),
  moveDelta: (args) => ipcRenderer.invoke('runtimeEnvironments:moveOctopodDelta', args),
  keepServerVersion: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:keepOctopodServerVersion', args),
  allowMoveLeavingBehind: (args) =>
    ipcRenderer.invoke('runtimeEnvironments:allowOctopodMoveLeavingBehind', args)
}
