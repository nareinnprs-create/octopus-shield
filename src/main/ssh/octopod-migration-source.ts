/** Expose fenced-source checks/release through the cutover port; conversion owns terminal assessment, export and fence acquisition. */
import type { OctopodMigrationSourceKind } from '../../shared/octopod-migration/octopod-migration-source-kind'
import type {
  OctopodMigrationCatalogPayload,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'
import type { OctopodMigrationSourceCutover } from '../../shared/octopod-migration/octopod-migration-source-cutover'
import type { OctopodMigrationManifestExportOptions } from './octopod-migration-manifest-export'
import type {
  OctopodMigrationFenceResult,
  OctopodMigrationFenceState
} from './octopod-migration-source-fence'
import type { OctopodMigrationTerminalVerdict } from './octopod-migration-terminal-gate'

export type OctopodMigrationSourceCutoverPort = {
  /** Before every stage and commit; throws unless the fenced source still matches the journal. */
  verifyFence: (cutover: OctopodMigrationSourceCutover) => void
  /** Drops the fence, then the journal; only on proof the destination holds nothing. */
  releaseFence: (cutover: OctopodMigrationSourceCutover) => Promise<void>
}

type OctopodMigrationFenceAcquireArgs = {
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: OctopodMigrationTerminalVerdict
  now?: () => Date
  signal?: AbortSignal
}

export type OctopodMigrationSource = OctopodMigrationSourceCutoverPort & {
  readonly kind: OctopodMigrationSourceKind
  readonly journalKey: string
  collectCatalog: () => OctopodMigrationCatalogPayload
  /** Rewrite paths before signing; export must not mutate source. */
  exportManifest: (options?: OctopodMigrationManifestExportOptions) => OctopodMigrationManifest
  /** Before the fence. Loss of contact is `unverifiable`, never `exited`. */
  assessTerminals: () => Promise<OctopodMigrationTerminalVerdict>
  retireProvenExitedTerminals: (proof: OctopodMigrationTerminalVerdict) => void
  /** Throws when the journal cannot be read: an unreadable record keeps the source fenced. */
  resolveFence: () => OctopodMigrationFenceState
  /** Journal, then fence, then flush, then the terminal re-check under the fence. */
  acquireFence: (args: OctopodMigrationFenceAcquireArgs) => Promise<OctopodMigrationFenceResult>
}
