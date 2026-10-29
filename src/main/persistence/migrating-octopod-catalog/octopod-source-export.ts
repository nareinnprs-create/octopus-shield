// Export copies of relay-hosted SSH state without mutating source rows.
import {
  OCTOPOD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
  type OctopodMigrationTerminalScrollbackSnapshot
} from '../../../shared/octopod-migration/octopod-migration-scrollback'
import type {
  OctopodMigrationCatalogPayload,
  OctopodMigrationDormantStatePayload,
  OctopodMigrationManifest,
  OctopodMigrationManifestSource
} from '../../../shared/octopod-migration/octopod-migration-manifest'
import { assertOctopodMigrationManifestDigest } from '../../octopod/octopod-migration-manifest-digest'
import type { StoreRuntimeState } from '../loading-store/store-runtime-state'
import {
  collectOctopodMigrationUntransferredDependencyCensus,
  type OctopodMigrationSourceDependencyCensus
} from './octopod-source-dependency-census'
import { collectOctopodMigrationSourceDormantState } from './octopod-source-dormant-state'
import { readOctopodMigrationSourceScrollbackChunk } from './octopod-source-scrollback-state'
import {
  createOctopodMigrationDeltaView,
  type OctopodMigrationDeltaView
} from './octopod-source-delta-view'
import { syncOctopodMigrationScrollbackRetention } from './octopod-source-scrollback-retention'
import { createOctopodMigrationLeaveBehindView } from './octopod-source-leave-behind-view'
import {
  collectOctopodMigrationSourceDrafts,
  type OctopodMigrationSourceDrafts
} from './octopod-source-draft-rename'

type OctopodSourceExportRuntime = Pick<
  StoreRuntimeState,
  'state' | 'terminalScrollbackSnapshotStorage' | 'retainedScrollbackRefsByMigrationId'
>

const octopodSourceExportContext = Symbol('OctopodSourceExportPersistence')

export class OctopodSourceExportPersistence {
  readonly [octopodSourceExportContext]: OctopodSourceExportRuntime

  constructor(runtime: OctopodSourceExportRuntime) {
    this[octopodSourceExportContext] = runtime
  }

  collectOctopodMigrationSourceDormantState(
    source: OctopodMigrationManifestSource,
    catalog: OctopodMigrationCatalogPayload,
    destinationEnvironmentId?: string
  ): OctopodMigrationDormantStatePayload {
    const runtime = this[octopodSourceExportContext]
    return collectOctopodMigrationSourceDormantState(
      runtime.state,
      source,
      catalog,
      runtime.terminalScrollbackSnapshotStorage,
      destinationEnvironmentId
    ).payload
  }

  collectOctopodMigrationSourceDrafts(manifest: OctopodMigrationManifest): OctopodMigrationSourceDrafts {
    return collectOctopodMigrationSourceDrafts(this[octopodSourceExportContext].state, manifest)
  }

  createOctopodMigrationDeltaView(moved: OctopodMigrationManifest): OctopodMigrationDeltaView {
    return createOctopodMigrationDeltaView(this[octopodSourceExportContext], moved)
  }

  /** Preview "Move anyway" without recording consent. */
  createOctopodMigrationLeaveBehindView(targetId: string): OctopodMigrationDeltaView {
    return createOctopodMigrationLeaveBehindView(this[octopodSourceExportContext], targetId)
  }

  inspectOctopodMigrationUntransferredDependencies(
    manifest: OctopodMigrationManifest
  ): OctopodMigrationSourceDependencyCensus {
    const runtime = this[octopodSourceExportContext]
    return collectOctopodMigrationUntransferredDependencyCensus(
      runtime.state,
      manifest,
      runtime.terminalScrollbackSnapshotStorage
    )
  }

  /** Retain unfinished migrations' snapshots even if their tabs close. */
  syncOctopodMigrationScrollbackRetention(pending: readonly OctopodMigrationManifest[]): void {
    syncOctopodMigrationScrollbackRetention(this[octopodSourceExportContext], pending)
  }

  /** Verify snapshot bytes against the signed manifest so changed buffers cannot be transferred. */
  readOctopodMigrationSourceSnapshotChunk(
    manifest: OctopodMigrationManifest,
    ref: string,
    offset: number
  ): { bytesBase64: string; totalBytes: number; eof: boolean } {
    assertOctopodMigrationManifestDigest(manifest)
    const descriptor: OctopodMigrationTerminalScrollbackSnapshot | undefined =
      manifest.payload.dormantState?.terminalScrollbackSnapshots?.find((entry) => entry.ref === ref)
    if (!descriptor) {
      throw new Error('octopod_migration_source_snapshot_unknown')
    }
    const runtime = this[octopodSourceExportContext]
    return readOctopodMigrationSourceScrollbackChunk({
      state: runtime.state,
      descriptor,
      retained: [...runtime.retainedScrollbackRefsByMigrationId.values()].some((refs) =>
        refs.has(ref)
      ),
      offset,
      length: OCTOPOD_MIGRATION_SCROLLBACK_CHUNK_BYTES,
      storage: runtime.terminalScrollbackSnapshotStorage
    })
  }
}
