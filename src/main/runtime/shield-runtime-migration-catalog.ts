import type {
  OctopodMigrationCatalogAbortResult,
  OctopodMigrationCatalogReference,
  OctopodMigrationCatalogReferenceAbortResult,
  OctopodMigrationCatalogState,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'
import type {
  OctopodMigrationSnapshotChunkRequest,
  OctopodMigrationSnapshotChunkResult
} from '../../shared/octopod-migration/octopod-migration-scrollback'
import type {
  OctopodMigrationBlobChunkRequest,
  OctopodMigrationBlobChunkResult,
  OctopodMigrationBlobDescriptor
} from '../../shared/octopod-migration/octopod-migration-blob-transfer'
import {
  abortStagedOctopodMigrationCatalogByReferenceDurably,
  abortStagedOctopodMigrationCatalogDurably,
  commitStagedOctopodMigrationCatalogDurably,
  getOctopodMigrationCatalogState,
  stageOctopodMigrationCatalogDurably
} from './octopod-migration-catalog-import'
import { ShieldRuntimeWithResolveWaiter } from './shield-runtime-resolve-waiter'
import type { RuntimeStore } from './runtime-store-contract'

type MigrationStoreKey =
  | 'stageOctopodMigrationCatalog'
  | 'commitStagedOctopodMigrationCatalog'
  | 'stageOctopodMigrationSnapshotChunk'
  | 'stageOctopodMigrationBlobChunk'
  | 'abortStagedOctopodMigrationCatalog'
  | 'abortStagedOctopodMigrationCatalogByReference'
  | 'getOctopodMigrationCatalogState'
  | 'flushPendingOrThrowAsync'

/** The destination half of a dormant catalog migration; every mutation is flushed before it answers. */
export abstract class ShieldRuntimeWithMigrationCatalog extends ShieldRuntimeWithResolveWaiter {
  async stageOctopodMigrationCatalog(
    manifest: OctopodMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<OctopodMigrationCatalogState> {
    return stageOctopodMigrationCatalogDurably({
      store: this.requireMigrationStore('stageOctopodMigrationCatalog', 'flushPendingOrThrowAsync'),
      manifest,
      signal: options.signal
    })
  }

  async commitStagedOctopodMigrationCatalog(
    manifest: OctopodMigrationManifest,
    options: { signal?: AbortSignal; expectedBlobs?: readonly OctopodMigrationBlobDescriptor[] } = {}
  ): Promise<OctopodMigrationCatalogState> {
    return commitStagedOctopodMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'commitStagedOctopodMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal,
      expectedBlobs: options.expectedBlobs,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells,
      onDurableCommit: () => {
        this.invalidateResolvedWorktreeCache()
        this.notifyReposChanged()
      }
    })
  }

  stageOctopodMigrationSnapshotChunk(
    request: OctopodMigrationSnapshotChunkRequest
  ): OctopodMigrationSnapshotChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageOctopodMigrationSnapshotChunk')
      .stageOctopodMigrationSnapshotChunk!(request)
  }

  stageOctopodMigrationBlobChunk(
    request: OctopodMigrationBlobChunkRequest
  ): OctopodMigrationBlobChunkResult {
    // SAFETY: The virtual Store may differ from the checked Store; preserve its native failure.
    return this.requireMigrationStore('stageOctopodMigrationBlobChunk').stageOctopodMigrationBlobChunk!(
      request
    )
  }

  async abortStagedOctopodMigrationCatalog(
    manifest: OctopodMigrationManifest,
    options: { signal?: AbortSignal } = {}
  ): Promise<OctopodMigrationCatalogAbortResult> {
    return abortStagedOctopodMigrationCatalogDurably({
      store: this.requireMigrationStore(
        'abortStagedOctopodMigrationCatalog',
        'flushPendingOrThrowAsync'
      ),
      manifest,
      signal: options.signal
    })
  }

  async abortStagedOctopodMigrationCatalogByReference(
    reference: OctopodMigrationCatalogReference,
    options: { signal?: AbortSignal } = {}
  ): Promise<OctopodMigrationCatalogReferenceAbortResult> {
    return abortStagedOctopodMigrationCatalogByReferenceDurably({
      store: this.requireMigrationStore(
        'abortStagedOctopodMigrationCatalogByReference',
        'flushPendingOrThrowAsync'
      ),
      reference,
      signal: options.signal
    })
  }

  getOctopodMigrationCatalogState(manifest: OctopodMigrationManifest): OctopodMigrationCatalogState {
    return getOctopodMigrationCatalogState({
      store: this.requireMigrationStore('getOctopodMigrationCatalogState'),
      manifest,
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  /** Install deferred migrated history after host-shell discovery; unanswered inventory retries on the next catalog query. */
  async installPendingOctopodMigrationShellHistory(): Promise<void> {
    const store = this.store
    // Every daemon start calls this; no pending blobs must cost no inventory.
    if (
      !store?.installPendingOctopodMigrationReceivedBlobs ||
      !store.hasPendingOctopodMigrationShellHistory?.()
    ) {
      return
    }
    // Inventory first to find restart-surviving shells; real worktrees preserve their restored orchestration receipts.
    if (
      this.ptyController?.listProcesses &&
      !(await this.refreshPtyWorktreeRecordsWithControllerInventory([
        ...(await this.getResolvedWorktreeMap()).values()
      ]))
    ) {
      console.warn('[octopod-migration] shell history waits: the terminal inventory did not answer')
      return
    }
    store.installPendingOctopodMigrationReceivedBlobs({
      worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
    })
  }

  override onPtyExit(
    ...args: Parameters<ShieldRuntimeWithResolveWaiter['onPtyExit']>
  ): ReturnType<ShieldRuntimeWithResolveWaiter['onPtyExit']> {
    const worktreeId = this.ptysById.get(args[0])?.worktreeId
    const result = super.onPtyExit(...args)
    if (worktreeId) {
      try {
        this.store?.installDeferredOctopodMigrationShellHistory?.(worktreeId, {
          worktreeHasLiveShells: this.migrationWorktreeHasLiveShells
        })
      } catch (error) {
        console.error('[octopod-migration] installing deferred shell history failed:', error)
      }
    }
    return result
  }

  // Migrated history belongs here; same-id SSH twins never write it.
  private readonly migrationWorktreeHasLiveShells = (worktreeId: string): boolean =>
    this.getLivePtyIdsForWorktree(worktreeId, undefined, { resolvedConnectionId: null }).size > 0

  // Check the captured Store, not a potentially different virtual return.
  private requireMigrationStore(...methods: MigrationStoreKey[]): RuntimeStore {
    const store = this.store
    if (!store || methods.some((method) => typeof store[method] !== 'function')) {
      throw new Error('runtime_unavailable')
    }
    return this.requireStore()
  }
}
