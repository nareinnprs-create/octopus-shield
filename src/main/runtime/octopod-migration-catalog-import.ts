import type {
  OctopodMigrationCatalogAbortResult,
  OctopodMigrationCatalogReference,
  OctopodMigrationCatalogReferenceAbortResult,
  OctopodMigrationCatalogState,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'
import type { OctopodMigrationBlobDescriptor } from '../../shared/octopod-migration/octopod-migration-blob-transfer'
import type { Store } from '../persistence'

/** A moved history waits while a shell runs in its worktree: that shell would overwrite it. */
type WorktreeHasLiveShells = (worktreeId: string) => boolean

type OctopodMigrationCatalogFlushStore = Partial<Pick<Store, 'flushPendingOrThrowAsync'>>
type OctopodMigrationCatalogStageStore = OctopodMigrationCatalogFlushStore &
  Partial<Pick<Store, 'stageOctopodMigrationCatalog'>>
type OctopodMigrationCatalogCommitStore = OctopodMigrationCatalogFlushStore &
  Partial<Pick<Store, 'commitStagedOctopodMigrationCatalog' | 'installOctopodMigrationReceivedBlobs'>>
type OctopodMigrationCatalogAbortStore = OctopodMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedOctopodMigrationCatalog'>>
type OctopodMigrationCatalogAbortByReferenceStore = OctopodMigrationCatalogFlushStore &
  Partial<Pick<Store, 'abortStagedOctopodMigrationCatalogByReference'>>

export async function stageOctopodMigrationCatalogDurably(args: {
  store: OctopodMigrationCatalogStageStore
  manifest: OctopodMigrationManifest
  signal?: AbortSignal
}): Promise<OctopodMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.stageOctopodMigrationCatalog!(args.manifest)
  await flushMigrationState(args.store, args.signal)
  return result
}

export async function commitStagedOctopodMigrationCatalogDurably(args: {
  store: OctopodMigrationCatalogCommitStore
  manifest: OctopodMigrationManifest
  signal?: AbortSignal
  expectedBlobs?: readonly OctopodMigrationBlobDescriptor[]
  onDurableCommit: () => void
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): Promise<OctopodMigrationCatalogState> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.commitStagedOctopodMigrationCatalog!(
    args.manifest,
    args.expectedBlobs ? { expectedBlobs: args.expectedBlobs } : {}
  )
  await flushMigrationState(args.store, args.signal)
  args.onDurableCommit()
  installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  return result
}

/** After the durable commit, on its retries and state queries; the store load retries too. */
function installReceivedBlobs(
  store: Partial<Pick<Store, 'installOctopodMigrationReceivedBlobs'>>,
  manifest: OctopodMigrationManifest,
  worktreeHasLiveShells: WorktreeHasLiveShells | undefined
): void {
  try {
    store.installOctopodMigrationReceivedBlobs?.(manifest, { worktreeHasLiveShells })
  } catch (error) {
    // The catalog is committed; a failed install keeps its blob for the next retry.
    console.error('[octopod-migration] installing received blobs failed:', error)
  }
}

export async function abortStagedOctopodMigrationCatalogDurably(args: {
  store: OctopodMigrationCatalogAbortStore
  manifest: OctopodMigrationManifest
  signal?: AbortSignal
}): Promise<OctopodMigrationCatalogAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedOctopodMigrationCatalog!(args.manifest)
  // An already-absent retry may follow an in-memory abort whose flush failed.
  if (result.state === 'absent') {
    await flushMigrationState(args.store, args.signal)
    return { ...result, durableAbsent: true }
  }
  return result
}

export async function abortStagedOctopodMigrationCatalogByReferenceDurably(args: {
  store: OctopodMigrationCatalogAbortByReferenceStore
  reference: OctopodMigrationCatalogReference
  signal?: AbortSignal
}): Promise<OctopodMigrationCatalogReferenceAbortResult> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.abortStagedOctopodMigrationCatalogByReference!(args.reference)
  if (result.state === 'absent') {
    await flushMigrationState(args.store, args.signal)
    return { ...result, durableAbsent: true }
  }
  return result
}

export function getOctopodMigrationCatalogState(args: {
  store: Partial<
    Pick<Store, 'getOctopodMigrationCatalogState' | 'installOctopodMigrationReceivedBlobs'>
  >
  manifest: OctopodMigrationManifest
  worktreeHasLiveShells?: WorktreeHasLiveShells
}): OctopodMigrationCatalogState {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  const result = args.store.getOctopodMigrationCatalogState!(args.manifest)
  if (result.state === 'committed') {
    installReceivedBlobs(args.store, args.manifest, args.worktreeHasLiveShells)
  }
  return result
}

function flushMigrationState(
  store: OctopodMigrationCatalogFlushStore,
  signal?: AbortSignal
): Promise<void> {
  // SAFETY: Returned or mutable Store slots retain their original native missing-method failure.
  return store.flushPendingOrThrowAsync!({
    signal,
    drainToStableGeneration: false
  })
}
