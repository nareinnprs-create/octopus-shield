/** Keep the dormant-migration cutover journal outside the profile store so older builds cannot strip it when saving. */
import { z } from 'zod'
import {
  MAX_OCTOPOD_MIGRATION_FOLDER_WORKSPACES,
  MAX_OCTOPOD_MIGRATION_PROJECT_GROUPS,
  MAX_OCTOPOD_MIGRATION_REPOSITORIES,
  parseOctopodMigrationManifest
} from './octopod-migration-manifest-validation'
import type { OctopodMigrationManifest } from './octopod-migration-manifest'
import { MAX_OCTOPOD_MIGRATION_DORMANT_ROWS } from './octopod-migration-dormant-value-validation'
import { isOctopodMigrationLocalWslSource } from './octopod-migration-source-kind'

export const OCTOPOD_MIGRATION_SOURCE_CUTOVER_VERSION = 1
export const MAX_OCTOPOD_MIGRATION_SOURCE_CUTOVERS = 4

export const OCTOPOD_MIGRATION_SOURCE_CUTOVER_PHASES = [
  'source-fenced',
  'destination-staged',
  'destination-committed',
  // Written only by earlier builds; read as committed, and nothing writes it now.
  'source-retired'
] as const

export type OctopodMigrationSourceCutoverPhase =
  (typeof OCTOPOD_MIGRATION_SOURCE_CUTOVER_PHASES)[number]

// Accept newer optional journal fields instead of making the whole journal unreadable.
const CutoverRecordSchema = z.object({
  version: z.literal(OCTOPOD_MIGRATION_SOURCE_CUTOVER_VERSION),
  migrationId: z.string().min(1).max(128),
  phase: z.enum(OCTOPOD_MIGRATION_SOURCE_CUTOVER_PHASES),
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  destinationEnvironmentId: z.string().min(1).max(256),
  destinationName: z.string().min(1).max(1_024),
  // Bind the fence to the exact registration and destination manifest.
  sshTargetId: z.string().min(1).max(1_024),
  sshTargetGeneration: z.number().int().positive(),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  // Terminals proven exited before the fence; any other live lease later means work started.
  provenPtyIds: z.array(z.string().min(1).max(256)).max(10_000),
  // COMPAT(legacy-relay-bridge, revisit 2027-01-15): leases converted while their relay may still
  // run them; the bridge serves those panes, so they never read as terminals started under the fence.
  bridgedPtyIds: z.array(z.string().min(1).max(256)).max(10_000).optional(),
  // Committed, with the source rows kept so a downgraded build still sees the host's projects.
  sourceRetainedAt: z.string().datetime().optional(),
  // Moved automations enabled on this desktop, still to be re-enabled on the server.
  automationsToEnableOnServer: z
    .array(z.string().min(1).max(1_024))
    .max(MAX_OCTOPOD_MIGRATION_DORMANT_ROWS)
    .optional(),
  // A delta move after an older build changed the source: the migration it extends, never merges.
  supersedesMigrationId: z.string().min(1).max(128).optional(),
  // What the retained source must still look like; absent means this manifest's own catalog.
  sourceBaselineFingerprint: z.string().min(1).max(64).optional(),
  // Source projects the server already held at the same host path: linked to its rows, not moved.
  linkedRepositoryIds: z
    .array(z.string().min(1).max(1_024))
    .max(MAX_OCTOPOD_MIGRATION_REPOSITORIES)
    .optional(),
  // Source project groups the server already holds, or only linked projects used: its record wins.
  linkedProjectGroupIds: z
    .array(z.string().min(1).max(1_024))
    .max(MAX_OCTOPOD_MIGRATION_PROJECT_GROUPS)
    .optional(),
  // Source folder workspaces the server already holds under the same id and folder (#27285).
  linkedFolderWorkspaceIds: z
    .array(z.string().min(1).max(1_024))
    .max(MAX_OCTOPOD_MIGRATION_FOLDER_WORKSPACES)
    .optional(),
  // Rows the source held, no move took, when the user kept the server's version: never a change.
  keptRepositoryIds: z
    .array(z.string().min(1).max(1_024))
    .max(MAX_OCTOPOD_MIGRATION_REPOSITORIES)
    .optional(),
  keptFolderWorkspaceIds: z
    .array(z.string().min(1).max(1_024))
    .max(MAX_OCTOPOD_MIGRATION_FOLDER_WORKSPACES)
    .optional(),
  manifest: z.unknown()
})

export type OctopodMigrationSourceCutover = Omit<z.infer<typeof CutoverRecordSchema>, 'manifest'> & {
  manifest: OctopodMigrationManifest
}

/** Committed and retained: finished for this build, its source rows kept for a downgrade. */
export function isRetainedOctopodMigrationSourceCutover(
  cutover: Pick<OctopodMigrationSourceCutover, 'phase' | 'sourceRetainedAt'>
): boolean {
  return cutover.phase === 'destination-committed' && cutover.sourceRetainedAt !== undefined
}

export function parseOctopodMigrationSourceCutover(value: unknown): OctopodMigrationSourceCutover {
  const record = CutoverRecordSchema.parse(value)
  const manifest = parseOctopodMigrationManifest(record.manifest)
  // An SSH journal binds an SSH manifest; a WSL manifest here is a mismatch, never a fallback.
  const source = isOctopodMigrationLocalWslSource(manifest.source) ? null : manifest.source
  if (
    manifest.migrationId !== record.migrationId ||
    manifest.manifestSha256 !== record.manifestSha256 ||
    source?.sshTargetId !== record.sshTargetId ||
    source.sshTargetGeneration !== record.sshTargetGeneration ||
    manifest.destinationEnvironmentId !== record.destinationEnvironmentId
  ) {
    throw new Error('octopod_migration_cutover_binding_mismatch')
  }
  return { ...record, manifest }
}
