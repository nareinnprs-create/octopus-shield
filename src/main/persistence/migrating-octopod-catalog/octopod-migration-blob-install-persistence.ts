import { OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS } from '../../../shared/octopod-migration/octopod-migration-blob-transfer'
import type { OctopodMigrationManifest } from '../../../shared/octopod-migration/octopod-migration-manifest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'
import { getHistoryRoot } from '../../terminal-history-paths'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  findOctopodMigrationImportReceipt,
  isOctopodMigrationCommitDurable
} from './octopod-catalog-receipt-ledger'
import { installOctopodMigrationReceivedBlobs } from './octopod-migration-blob-installers'
import { listOctopodMigrationReceivedBlobNames } from './octopod-migration-blob-staging'
import type { OctopodMigrationRequestIdentity } from './octopod-migration-staged-file'

type OctopodMigrationBlobInstallRuntime = Pick<
  StoreRuntimeState,
  | 'state'
  | 'octopodMigrationBlobRoot'
  | 'octopodTerminalRestoreHints'
  | 'paneShellPath'
  | 'deferredShellHistoryWorktreeIds'
  | 'writeGeneration'
  | 'lastDurableWriteGeneration'
  | 'octopodMigrationCommitWriteGenerations'
>

type ClockOptions = { now?: () => Date }
type InstallOptions = ClockOptions & {
  /** Defer history installation while shells run in its worktree. */
  worktreeHasLiveShells?: (worktreeId: string) => boolean
}

const octopodMigrationBlobInstallContext = Symbol('OctopodMigrationBlobInstallPersistence')
type OctopodMigrationBlobInstallContext = {
  runtime: OctopodMigrationBlobInstallRuntime
}

export class OctopodMigrationBlobInstallPersistence {
  readonly [octopodMigrationBlobInstallContext]: OctopodMigrationBlobInstallContext

  constructor(runtime: OctopodMigrationBlobInstallRuntime) {
    this[octopodMigrationBlobInstallContext] = { runtime }
  }

  /** Wait for durable commit or a restart could lose both the catalog and its consumed blobs. */
  installOctopodMigrationReceivedBlobs(
    manifest: OctopodMigrationManifest,
    options: InstallOptions = {}
  ): void {
    const receipt = findOctopodMigrationImportReceipt(
      this[octopodMigrationBlobInstallContext].runtime.state,
      manifest
    )
    if (receipt?.manifestSha256 !== manifest.manifestSha256) {
      return
    }
    installCommitted(this[octopodMigrationBlobInstallContext].runtime, manifest, options)
  }

  /** Recover interrupted installs; disk-loaded receipts already prove durability. */
  installPendingOctopodMigrationReceivedBlobs(options: InstallOptions = {}): void {
    const { runtime } = this[octopodMigrationBlobInstallContext]
    for (const receipt of [
      ...(runtime.state.octopodMigrationImportReceipts ?? []),
      ...(runtime.state.octopodMigrationEvictedReceipts ?? [])
    ]) {
      try {
        installCommitted(runtime, receipt, options)
      } catch (error) {
        console.error(
          `[octopod-migration] installing received blobs for ${receipt.migrationId} failed:`,
          error
        )
      }
    }
  }

  /** Only the runtime installs pending shell history. */
  hasPendingOctopodMigrationShellHistory(): boolean {
    const { runtime } = this[octopodMigrationBlobInstallContext]
    return [
      ...(runtime.state.octopodMigrationImportReceipts ?? []),
      ...(runtime.state.octopodMigrationEvictedReceipts ?? [])
    ].some((receipt) =>
      listOctopodMigrationReceivedBlobNames(
        runtime.octopodMigrationBlobRoot,
        receipt,
        'shell-history'
      ).some((key) => OCTOPOD_MIGRATION_BLOB_KIND_CONTRACTS['shell-history'].key.test(key))
    )
  }

  installDeferredOctopodMigrationShellHistory(
    worktreeId: string,
    options: InstallOptions = {}
  ): void {
    const { runtime } = this[octopodMigrationBlobInstallContext]
    if (runtime.deferredShellHistoryWorktreeIds.has(worktreeId)) {
      this.installPendingOctopodMigrationReceivedBlobs(options)
    }
  }

  /** Read without consuming. */
  peekOctopodMigrationTerminalRestoreHint(
    paneKey: string,
    worktreeId: string,
    options: ClockOptions = {}
  ): string | null {
    return this[octopodMigrationBlobInstallContext].runtime.octopodTerminalRestoreHints.peek(
      paneKey,
      worktreeId,
      clock(options)
    )
  }

  /** Consume after spawn, even if it used a different cwd. */
  consumeOctopodMigrationTerminalRestoreHint(paneKey: string, options: ClockOptions = {}): void {
    this[octopodMigrationBlobInstallContext].runtime.octopodTerminalRestoreHints.consume(
      paneKey,
      clock(options)
    )
  }
}

function installCommitted(
  runtime: OctopodMigrationBlobInstallRuntime,
  migration: OctopodMigrationRequestIdentity,
  options: InstallOptions
): void {
  if (!isOctopodMigrationCommitDurable(runtime, migration)) {
    return
  }
  installOctopodMigrationReceivedBlobs({
    migration,
    root: runtime.octopodMigrationBlobRoot,
    terminalRestoreHints: runtime.octopodTerminalRestoreHints,
    shellHistoryRoot: getHistoryRoot(),
    paneShellPath: () => runtime.paneShellPath(runtime.state.settings?.terminalDefaultShell),
    worktreeHasLiveShells: options.worktreeHasLiveShells,
    deferredShellHistoryWorktreeIds: runtime.deferredShellHistoryWorktreeIds,
    paneWorktreeId: (paneKey) => findPaneWorktreeId(runtime.state, paneKey),
    now: clock(options)
  })
}

function clock(options: ClockOptions): number {
  return (options.now ?? (() => new Date()))().getTime()
}

function findPaneWorktreeId(state: PersistedState, paneKey: string): string | null {
  const tabId = parsePaneKey(paneKey)?.tabId
  if (!tabId) {
    return null
  }
  const sessions = [state.workspaceSession, ...Object.values(state.workspaceSessionsByHostId ?? {})]
  for (const session of sessions) {
    for (const [worktreeId, tabs] of Object.entries(session?.tabsByWorktree ?? {})) {
      if (tabs.some((tab) => tab.id === tabId)) {
        return worktreeId
      }
    }
  }
  return null
}
