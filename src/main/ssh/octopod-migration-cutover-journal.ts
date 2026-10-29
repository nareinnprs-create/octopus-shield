/** Persist journals in owner-only profile sidecars: older profile schemas drop unknown fields but retain fences, so an in-profile journal could vanish on downgrade. Unreadable journals fail closed. */
import {
  MAX_OCTOPOD_MIGRATION_SOURCE_CUTOVERS,
  isRetainedOctopodMigrationSourceCutover,
  parseOctopodMigrationSourceCutover,
  type OctopodMigrationSourceCutover
} from '../../shared/octopod-migration/octopod-migration-source-cutover'
import {
  createMigrationJournalDirectory,
  orderMigrationJournalChain
} from '../persistence/migrating-octopod-catalog/migration-journal-directory'

class OctopodMigrationCutoverJournalUnreadableError extends Error {
  constructor(detail: string) {
    super(`The migration journal cannot be read, so the SSH host stays fenced: ${detail}`)
    this.name = 'OctopodMigrationCutoverJournalUnreadableError'
  }
}

type JournalChangeListener = (userDataPath: string) => void
let journalChangeListener: JournalChangeListener | null = null

export function setOctopodMigrationJournalChangeListener(
  listener: JournalChangeListener | null
): void {
  journalChangeListener = listener
}

const journals = createMigrationJournalDirectory({
  directoryName: 'octopod-migration-cutovers',
  // A manifest carries catalog rows and dormant session state, never scrollback bytes.
  maxFileBytes: 16 * 1024 * 1024,
  parse: parseOctopodMigrationSourceCutover,
  unreadable: (detail) => new OctopodMigrationCutoverJournalUnreadableError(detail),
  onChange: (userDataPath) => journalChangeListener?.(userDataPath)
})

export function octopodMigrationCutoverJournalDirectory(userDataPath: string): string {
  return journals.directory(userDataPath)
}

/** Never skip an unreadable or untrusted journal. */
export function listOctopodMigrationSourceCutovers(
  userDataPath: string
): OctopodMigrationSourceCutover[] {
  return journals.list(userDataPath)
}

export function findOctopodMigrationSourceCutoverForTarget(
  userDataPath: string,
  sshTargetId: string
): OctopodMigrationSourceCutover | null {
  const chain = listOctopodMigrationCutoverChainForTarget(userDataPath, sshTargetId)
  return chain.at(-1) ?? null
}

/** Oldest first; throws unless the target's journals form one chain of delta moves. */
export function listOctopodMigrationCutoverChainForTarget(
  userDataPath: string,
  sshTargetId: string
): OctopodMigrationSourceCutover[] {
  const matches = listOctopodMigrationSourceCutovers(userDataPath).filter(
    (cutover) => cutover.sshTargetId === sshTargetId
  )
  return orderMigrationJournalChain(
    matches,
    (detail) => new OctopodMigrationCutoverJournalUnreadableError(detail),
    `SSH target ${sshTargetId}`
  )
}

/** Flush before returning so later fence writes always have a durable journal. */
export function writeOctopodMigrationSourceCutover(
  userDataPath: string,
  cutover: OctopodMigrationSourceCutover
): void {
  const parsed = parseOctopodMigrationSourceCutover(cutover)
  const existing = listOctopodMigrationSourceCutovers(userDataPath)
  // Finished retained cutovers can wait two releases; only in-flight journals count toward the bound.
  const inFlight = existing.filter(
    (entry) => entry.phase !== 'source-retired' && !isRetainedOctopodMigrationSourceCutover(entry)
  )
  if (
    !existing.some((entry) => entry.migrationId === parsed.migrationId) &&
    inFlight.length >= MAX_OCTOPOD_MIGRATION_SOURCE_CUTOVERS
  ) {
    throw new Error('octopod_migration_cutover_capacity_exceeded')
  }
  journals.write(userDataPath, parsed)
}

export function removeOctopodMigrationSourceCutover(userDataPath: string, migrationId: string): void {
  journals.remove(userDataPath, migrationId)
}

export function removeOctopodMigrationJournalsForDestination(
  userDataPath: string,
  sshTargetId: string,
  environmentId: string
): void {
  for (const cutover of listOctopodMigrationSourceCutovers(userDataPath)) {
    if (cutover.sshTargetId === sshTargetId && cutover.destinationEnvironmentId === environmentId) {
      removeOctopodMigrationSourceCutover(userDataPath, cutover.migrationId)
    }
  }
}
