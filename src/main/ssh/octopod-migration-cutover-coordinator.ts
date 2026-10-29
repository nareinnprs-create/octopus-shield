/** Keep source authority until durable destination commit. Verify the fenced export before stage/commit; resolve lost replies by catalog reads and persist journal transitions before returning. Never release a committed destination. */
import type {
  OctopodMigrationCatalogAbortResult,
  OctopodMigrationCatalogReferenceAbortResult,
  OctopodMigrationCatalogState,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'
import type {
  OctopodMigrationSnapshotChunkRequest,
  OctopodMigrationSnapshotChunkResult
} from '../../shared/octopod-migration/octopod-migration-scrollback'
import type {
  OctopodMigrationSourceCutover,
  OctopodMigrationSourceCutoverPhase
} from '../../shared/octopod-migration/octopod-migration-source-cutover'
import { resolveDurableOctopodCatalogMutation } from './octopod-catalog-durable-mutation'
import { OCTOPOD_MIGRATION_DESTINATION_UNSUPPORTED } from './octopod-migration-catalog-client'
import { octopodMigrationRequestFits } from './octopod-migration-manifest-export'
import {
  listOctopodMigrationSourceCutovers,
  writeOctopodMigrationSourceCutover
} from './octopod-migration-cutover-journal'
import type { OctopodMigrationSourceCutoverPort } from './octopod-migration-source'
import {
  transferOctopodMigrationSnapshots,
  type OctopodMigrationSnapshotSource
} from './octopod-migration-snapshot-coordinator'
import type { OctopodMigrationPreflightStore } from './targets/ssh-target-octopod-preflight'
import { sshRelayMigrationCutoverPort } from './octopod-migration-ssh-relay-source'
import type { SshTargetOctopodClaims } from './targets/ssh-target-octopod-claims'

export type OctopodMigrationDestinationCatalog = {
  readState: (manifest: OctopodMigrationManifest) => Promise<OctopodMigrationCatalogState>
  stage: (manifest: OctopodMigrationManifest) => Promise<OctopodMigrationCatalogState>
  commit: (manifest: OctopodMigrationManifest) => Promise<OctopodMigrationCatalogState>
  abort: (manifest: OctopodMigrationManifest) => Promise<OctopodMigrationCatalogAbortResult>
  /** Use identity-only abort when the journal's full manifest cannot fit a request. */
  abortByReference: (
    manifest: OctopodMigrationManifest
  ) => Promise<OctopodMigrationCatalogReferenceAbortResult>
  stageChunk: (
    request: OctopodMigrationSnapshotChunkRequest
  ) => Promise<OctopodMigrationSnapshotChunkResult>
}

export type OctopodMigrationCutoverContext = {
  userDataPath: string
  store: OctopodMigrationPreflightStore & OctopodMigrationSnapshotSource
  claims: SshTargetOctopodClaims
  destination: OctopodMigrationDestinationCatalog
  /** Rebuild copied stores for each check so concurrent edits remain visible. */
  freshSource?: () => OctopodMigrationPreflightStore
  /** The fenced source; defaults to the relay-era SSH target the journal names. */
  source?: OctopodMigrationSourceCutoverPort
  now?: () => Date
}

function cutoverSource(context: OctopodMigrationCutoverContext): OctopodMigrationSourceCutoverPort {
  return context.source ?? sshRelayMigrationCutoverPort(context)
}

export async function stageOctopodMigrationDestination(
  context: OctopodMigrationCutoverContext,
  migrationId: string
): Promise<OctopodMigrationSourceCutover> {
  let cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return cutover
  }
  assertSourceUnchanged(context, cutover)
  const { destination } = context
  const read = await destination.readState(cutover.manifest)
  const state =
    read.state === 'committed'
      ? await confirmDurableCommit(destination, cutover.manifest)
      : await resolveDurableOctopodCatalogMutation(
          () => destination.stage(cutover.manifest),
          () => destination.readState(cutover.manifest),
          (observed) => observed.state !== 'absent'
        )
  cutover = recordObservedState(context, cutover, state)
  if (state.state === 'staged') {
    await transferOctopodMigrationSnapshots({
      source: context.store,
      manifest: cutover.manifest,
      state,
      destination: { readState: destination.readState, stageChunk: destination.stageChunk }
    })
  }
  return cutover
}

export async function commitOctopodMigrationDestination(
  context: OctopodMigrationCutoverContext,
  migrationId: string
): Promise<OctopodMigrationSourceCutover> {
  const staged = await stageOctopodMigrationDestination(context, migrationId)
  if (staged.phase !== 'destination-staged') {
    return staged
  }
  assertSourceUnchanged(context, staged)
  const { destination } = context
  // A lost commit reply may hide success; catalog read decides the next step.
  const state = await resolveDurableOctopodCatalogMutation(
    () => destination.commit(staged.manifest),
    () => destination.readState(staged.manifest),
    (observed) => observed.state === 'committed'
  )
  if (state.state !== 'committed') {
    throw new Error(`octopod_migration_commit_not_committed:${state.state}`)
  }
  return recordObservedState(context, staged, state)
}

export type OctopodMigrationAbortResult =
  | { outcome: 'released'; evidence: 'catalog-absent' | 'destination-unsupported' }
  | { outcome: 'refused'; code: string; reason: string }

/** Release only on proven destination absence; default drops journal/fence, while delta moves retain the fence. */
export async function abortOctopodMigrationCutover(
  context: OctopodMigrationCutoverContext,
  migrationId: string,
  release: (cutover: OctopodMigrationSourceCutover) => Promise<void> = (cutover) =>
    cutoverSource(context).releaseFence(cutover)
): Promise<OctopodMigrationAbortResult> {
  const cutover = requireCutover(context.userDataPath, migrationId)
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    return committedRefusal()
  }
  const { destination } = context
  // Older journals can hold oversized manifests; identity-only abort must still release them.
  if (!octopodMigrationRequestFits({ manifest: cutover.manifest })) {
    const aborted = await destination.abortByReference(cutover.manifest)
    if (aborted.state === 'committed') {
      return committedRefusal()
    }
    await release(cutover)
    return { outcome: 'released', evidence: 'catalog-absent' }
  }
  let state: OctopodMigrationCatalogState
  try {
    state = await destination.readState(cutover.manifest)
  } catch (error) {
    // Unsupported proves absence only before any stage could have landed.
    if (isDestinationUnsupported(error) && cutover.phase === 'source-fenced') {
      await release(cutover)
      return { outcome: 'released', evidence: 'destination-unsupported' }
    }
    throw error
  }
  if (state.state !== 'committed') {
    state = await abortWithRecovery(destination, cutover.manifest)
  }
  if (state.state === 'committed') {
    recordObservedState(context, cutover, await confirmDurableCommit(destination, cutover.manifest))
    return committedRefusal()
  }
  if (state.state !== 'absent') {
    throw new Error(`octopod_migration_abort_not_absent:${state.state}`)
  }
  await release(cutover)
  return { outcome: 'released', evidence: 'catalog-absent' }
}

/** Committed reads may be unflushed memory; require the idempotent commit acknowledgement to prove durability. */
async function confirmDurableCommit(
  destination: OctopodMigrationDestinationCatalog,
  manifest: OctopodMigrationManifest
): Promise<OctopodMigrationCatalogState> {
  const state = await destination.commit(manifest)
  if (state.state !== 'committed') {
    throw new Error(`octopod_migration_commit_not_committed:${state.state}`)
  }
  return state
}

function assertSourceUnchanged(
  context: OctopodMigrationCutoverContext,
  cutover: OctopodMigrationSourceCutover
): void {
  cutoverSource(context).verifyFence(cutover)
}

/** Persist observed state before returning. */
function recordObservedState(
  context: OctopodMigrationCutoverContext,
  cutover: OctopodMigrationSourceCutover,
  state: OctopodMigrationCatalogState
): OctopodMigrationSourceCutover {
  if (state.state === 'absent') {
    throw new Error('octopod_migration_destination_catalog_absent')
  }
  if (
    state.migrationId !== cutover.migrationId ||
    state.manifestSha256 !== cutover.manifestSha256
  ) {
    throw new Error('octopod_migration_destination_state_mismatch')
  }
  if (
    state.state === 'committed' &&
    (state.receipt.migrationId !== cutover.migrationId ||
      state.receipt.manifestSha256 !== cutover.manifestSha256)
  ) {
    throw new Error('octopod_migration_destination_receipt_mismatch')
  }
  const phase: OctopodMigrationSourceCutoverPhase =
    state.state === 'committed' ? 'destination-committed' : 'destination-staged'
  if (phase === cutover.phase) {
    return cutover
  }
  if (cutover.phase === 'destination-committed' || cutover.phase === 'source-retired') {
    // Never regress a proven commit.
    return cutover
  }
  const next: OctopodMigrationSourceCutover = {
    ...cutover,
    phase,
    updatedAt: (context.now ?? (() => new Date()))().toISOString()
  }
  writeOctopodMigrationSourceCutover(context.userDataPath, next)
  return next
}

async function abortWithRecovery(
  destination: OctopodMigrationDestinationCatalog,
  manifest: OctopodMigrationManifest
): Promise<OctopodMigrationCatalogState> {
  try {
    return await destination.abort(manifest)
  } catch (abortError) {
    try {
      const observed = await destination.readState(manifest)
      if (observed.state === 'committed') {
        return observed
      }
      if (observed.state === 'absent') {
        // Absent reads may predate flush; repeat abort to prove durable absence.
        return await destination.abort(manifest)
      }
    } catch {
      // Keep the original failure and fence while abort remains unverifiable.
    }
    throw abortError
  }
}

function requireCutover(userDataPath: string, migrationId: string): OctopodMigrationSourceCutover {
  const cutover = listOctopodMigrationSourceCutovers(userDataPath).find(
    (entry) => entry.migrationId === migrationId
  )
  if (!cutover) {
    throw new Error('octopod_migration_source_cutover_not_found')
  }
  return cutover
}

function committedRefusal(): OctopodMigrationAbortResult {
  return {
    outcome: 'refused',
    code: 'octopod_migration_committed_source_cannot_be_released',
    reason: 'This host’s Shield server already holds this migration; it can only move forward.'
  }
}

function isDestinationUnsupported(error: unknown): boolean {
  return error instanceof Error && error.message === OCTOPOD_MIGRATION_DESTINATION_UNSUPPORTED
}
