/** Legacy SSH omits source.kind to preserve signed bytes/digests. Other kinds must set kind and omit sshTargetId:
 * older destinations strip unknown fields, then fail parsing instead of importing a non-SSH source as SSH. */
import type {
  OctopodMigrationLocalWslManifestSource,
  OctopodMigrationManifestSource,
  OctopodMigrationSshManifestSource
} from './octopod-migration-manifest'
import { OCTOPOD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY } from '../octopod-runtime-capabilities'

export const OCTOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND = 'ssh-relay' as const

/** Non-SSH kinds and the destination capability that proves a destination parses each one. */
export const OCTOPOD_MIGRATION_SOURCE_KIND_CAPABILITIES = {
  'local-wsl': OCTOPOD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
} as const

export type OctopodMigrationNonSshSourceKind = keyof typeof OCTOPOD_MIGRATION_SOURCE_KIND_CAPABILITIES
export type OctopodMigrationSourceKind =
  | typeof OCTOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND
  | OctopodMigrationNonSshSourceKind

export const OCTOPOD_MIGRATION_SOURCE_KIND_UNKNOWN = 'octopod_migration_source_kind_unknown'

/** A manifest source as it travels: this build may not know every field a newer peer signed. */
export type OctopodMigrationWireSource = Readonly<Record<string, unknown>>

export function octopodMigrationManifestSourceKind(
  source: OctopodMigrationWireSource
): OctopodMigrationSourceKind {
  if (source.kind === undefined) {
    return OCTOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND
  }
  // An explicit 'ssh-relay' is refused too: SSH has exactly one encoding, so one digest.
  if (isNonSshSourceKind(source.kind)) {
    return source.kind
  }
  throw new Error(OCTOPOD_MIGRATION_SOURCE_KIND_UNKNOWN)
}

function isNonSshSourceKind(kind: unknown): kind is OctopodMigrationNonSshSourceKind {
  return typeof kind === 'string' && Object.hasOwn(OCTOPOD_MIGRATION_SOURCE_KIND_CAPABILITIES, kind)
}

/** The capability a destination must advertise before it may see this source; null for SSH. */
export function requiredOctopodMigrationSourceCapability(
  source: OctopodMigrationWireSource
): string | null {
  const kind = octopodMigrationManifestSourceKind(source)
  return kind === OCTOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND
    ? null
    : OCTOPOD_MIGRATION_SOURCE_KIND_CAPABILITIES[kind]
}

export function isOctopodMigrationLocalWslSource(
  source: OctopodMigrationManifestSource
): source is OctopodMigrationLocalWslManifestSource {
  return 'kind' in source && source.kind === 'local-wsl'
}

/** For the SSH conversion's own steps: a WSL manifest reaching them is a bug, never a fallback. */
export function requireOctopodMigrationSshSource(
  source: OctopodMigrationManifestSource
): OctopodMigrationSshManifestSource {
  if (isOctopodMigrationLocalWslSource(source)) {
    throw new Error('octopod_migration_source_not_ssh')
  }
  return source
}
