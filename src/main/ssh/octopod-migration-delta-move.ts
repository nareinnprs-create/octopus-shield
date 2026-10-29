/** Journal only additions made after conversion to the same server; retain the full journal chain and source rows. Stage conflicts leave the changed mark and source intact; uncertain outcomes keep the journal for resume. */
import {
  OCTOPOD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type OctopodMigrationSourceCutover
} from '../../shared/octopod-migration/octopod-migration-source-cutover'
import type { OctopodDeltaMoveResult } from '../../shared/octopod-managed-runtime'
import { recordManagedOctopodMigration } from '../../shared/runtime-environment-managed-octopod-store'
import type { KnownRuntimeEnvironment } from '../../shared/runtime-environments'
import type { SshTarget } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import {
  abortOctopodMigrationCutover,
  commitOctopodMigrationDestination,
  type OctopodMigrationCutoverContext,
  type OctopodMigrationDestinationCatalog
} from './octopod-migration-cutover-coordinator'
import {
  findOctopodMigrationSourceCutoverForTarget,
  listOctopodMigrationCutoverChainForTarget,
  removeOctopodMigrationSourceCutover,
  writeOctopodMigrationSourceCutover
} from './octopod-migration-cutover-journal'
import {
  committedOctopodMigrationChain,
  octopodDeltaSourceStore,
  planOctopodDeltaMove,
  unfinishedOctopodDelta,
  type OctopodDeltaMovePlan
} from './octopod-migration-delta-plan'
import { assertOctopodMigrationRequestFits } from './octopod-migration-manifest-export'
import { retainOctopodMigrationSource } from './octopod-migration-source-retention'
import {
  assessOctopodMigrationTerminals,
  type OctopodMigrationTerminalVerdict,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './octopod-migration-terminal-gate'
import {
  currentOctopodSourceFingerprint,
  octopodCatalogFingerprint,
  unmovedOctopodSourceRows,
  withKeptOctopodSourceRows
} from './octopod-retained-source'
import { collectOctopodMigrationSourceCatalog } from '../persistence/migrating-octopod-catalog/octopod-source-catalog'
import type { SshTargetOctopodClaims } from './targets/ssh-target-octopod-claims'
import { octopodMigrationRefusalReason } from './octopod-migration-refusal-reason'
import { errorMessage } from '../../shared/error-message'

type OctopodDeltaMoveArgs = {
  userDataPath: string
  store: Store
  claims: SshTargetOctopodClaims
  target: SshTarget
  environment: KnownRuntimeEnvironment
  /** Build the destination after opening its tunnel: re-pairing during open can replace commit credentials. */
  connectDestination: () => Promise<OctopodMigrationDestinationCatalog>
  /** Host census proves exit or identifies terminals preserved by the legacy bridge. */
  censusHost?: CensusHostRelayTerminals | null
  /** Serialize journal-through-commit with all other lifecycle changes to this host. */
  runTargetLifecycle: <T>(targetId: string, operation: () => Promise<T>) => Promise<T>
  now?: () => Date
}

export async function runOctopodDeltaMove(args: OctopodDeltaMoveArgs): Promise<OctopodDeltaMoveResult> {
  const { userDataPath, store, target } = args
  const now = args.now ?? (() => new Date())
  const plan = planOctopodDeltaMove(userDataPath, store, target, { now })
  // Capture baseline with the manifest before awaiting so both describe the same source.
  const planned = currentOctopodSourceFingerprint(store, target)
  if (!plan.resumes && plan.added.length === 0) {
    return refuse('octopod_delta_nothing_new', 'An older build added nothing new to move.')
  }
  if (plan.blockers.length > 0) {
    return {
      ...refuse('octopod_migration_preflight_blocked', octopodMigrationRefusalReason(plan.blockers)),
      blockers: plan.blockers
    }
  }
  if (!plan.resumes) {
    // Reject before journaling or an unsendable delta could pin the fence permanently.
    assertOctopodMigrationRequestFits({ manifest: plan.manifest })
  }
  const terminals = await assessOctopodMigrationTerminals(store, target.id, args.censusHost)
  if (terminals.verdict !== 'exited' && terminals.verdict !== 'bridged') {
    return refuse('octopod_migration_terminals', terminals.reason)
  }
  const settled: SettledTerminals = terminals
  retireProvenExitedLeases(store, target.id, terminals)
  return args.runTargetLifecycle(target.id, async () => {
    // Another move may have journaled or finished while waiting for the lifecycle lock.
    const changedAt = store.getSshTarget(target.id)?.octopodFence?.sourceChangedAt
    const head = findOctopodMigrationSourceCutoverForTarget(userDataPath, target.id)
    if (!changedAt || head?.migrationId !== (plan.resumes ?? plan.head).migrationId) {
      return refuse('octopod_delta_superseded', 'Another move of this host ran first.')
    }
    // Source remains writable before fencing; edits during census must not silently become the manifest's baseline.
    if (!plan.resumes && planned !== currentOctopodSourceFingerprint(store, target)) {
      return refuse(
        'octopod_delta_source_changed',
        'This host changed while the move was starting. Try the move again.'
      )
    }
    const cutover = plan.resumes ?? journalDelta(args, plan, planned, settled, now)
    return commitDelta(args, plan, cutover, changedAt, now)
  })
}

type SettledTerminals = Extract<OctopodMigrationTerminalVerdict, { verdict: 'exited' | 'bridged' }>

function journalDelta(
  args: OctopodDeltaMoveArgs,
  plan: OctopodDeltaMovePlan,
  planned: string,
  terminals: SettledTerminals,
  now: () => Date
): OctopodMigrationSourceCutover {
  const timestamp = now().toISOString()
  const cutover: OctopodMigrationSourceCutover = {
    version: OCTOPOD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: plan.manifest.migrationId,
    phase: 'source-fenced',
    startedAt: timestamp,
    updatedAt: timestamp,
    destinationEnvironmentId: plan.environmentId,
    destinationName: plan.head.destinationName,
    sshTargetId: args.target.id,
    sshTargetGeneration: plan.head.sshTargetGeneration,
    manifestSha256: plan.manifest.manifestSha256,
    provenPtyIds: terminals.verdict === 'exited' ? terminals.provenPtyIds : [],
    // COMPAT(legacy-relay-bridge): a move leaves relay terminals running for the bridge too.
    ...(terminals.verdict === 'bridged' ? { bridgedPtyIds: terminals.bridgedPtyIds } : {}),
    supersedesMigrationId: plan.head.migrationId,
    // Retained rows must match the whole source captured with this manifest.
    sourceBaselineFingerprint: planned,
    manifest: plan.manifest
  }
  writeOctopodMigrationSourceCutover(args.userDataPath, cutover)
  return cutover
}

async function commitDelta(
  args: OctopodDeltaMoveArgs,
  plan: OctopodDeltaMovePlan,
  cutover: OctopodMigrationSourceCutover,
  changedAt: string,
  now: () => Date
): Promise<OctopodDeltaMoveResult> {
  const { userDataPath, store, target } = args
  // Clear the changed mark and freeze source for the move.
  store.updateSshTarget(target.id, { octopodFence: { environmentId: plan.environmentId } })
  await args.claims.flush()
  // Record before any new/resumed commit so rollback cannot cross the migration.
  recordManagedOctopodMigration(userDataPath, plan.environmentId, now().toISOString())
  let destination: OctopodMigrationDestinationCatalog
  try {
    destination = await args.connectDestination()
  } catch (error) {
    // No request reached the server; keep the journal for later resume.
    await restoreChangedMark(args, cutover, changedAt)
    throw error
  }
  const context: OctopodMigrationCutoverContext = {
    userDataPath,
    store: plan.source,
    freshSource: () => octopodDeltaSourceStore(store, target, plan.moved, cutover.manifest),
    claims: args.claims,
    destination,
    now
  }
  try {
    const committed = await commitOctopodMigrationDestination(context, cutover.migrationId)
    if (committed.phase !== 'destination-committed' && committed.phase !== 'source-retired') {
      throw new Error(`octopod_migration_commit_not_proven:${committed.phase}`)
    }
  } catch (error) {
    const released = await releaseUncommittedDelta(args, context, cutover, changedAt)
    if (released === 'released') {
      return refuse('octopod_delta_refused_by_server', errorMessage(error))
    }
    if (released === 'kept') {
      throw error
    }
  }
  await retainOctopodMigrationSource(userDataPath, cutover.migrationId, store, now)
  return { outcome: 'moved', migrationId: cutover.migrationId }
}

/** Release only on proven destination absence; otherwise retain journal for resume. Restore the host's changed mark either way. */
async function releaseUncommittedDelta(
  args: OctopodDeltaMoveArgs,
  context: OctopodMigrationCutoverContext,
  cutover: OctopodMigrationSourceCutover,
  changedAt: string
): Promise<'released' | 'committed' | 'kept'> {
  const restoreMark = (): Promise<void> => restoreChangedMark(args, cutover, changedAt)
  try {
    const result = await abortOctopodMigrationCutover(context, cutover.migrationId, async () => {
      // Restore the mark first so a crash during journal removal leaves a resumable marked host.
      await restoreMark()
      removeOctopodMigrationSourceCutover(args.userDataPath, cutover.migrationId)
    })
    return result.outcome === 'released' ? 'released' : 'committed'
  } catch {
    await restoreMark()
    return 'kept'
  }
}

async function restoreChangedMark(
  args: Pick<OctopodDeltaMoveArgs, 'store' | 'claims'>,
  cutover: OctopodMigrationSourceCutover,
  changedAt: string
): Promise<void> {
  args.store.updateSshTarget(cutover.sshTargetId, {
    octopodFence: { environmentId: cutover.destinationEnvironmentId, sourceChangedAt: changedAt }
  })
  await args.claims.flush()
}

/** Keep older-build changes only in retained profile rows. */
export async function keepOctopodServerVersion(args: {
  userDataPath: string
  store: Store
  claims: SshTargetOctopodClaims
  target: SshTarget
}): Promise<void> {
  const environmentId = args.target.octopodFence?.environmentId
  const chain = listOctopodMigrationCutoverChainForTarget(args.userDataPath, args.target.id)
  if (unfinishedOctopodDelta(chain)) {
    // Unfinished moves may already have copied rows; only commit/abort can decide.
    throw new Error('octopod_delta_move_unfinished')
  }
  const head = committedOctopodMigrationChain(chain).at(-1)
  if (!environmentId || !args.target.octopodFence?.sourceChangedAt || !head) {
    throw new Error('octopod_delta_not_changed')
  }
  const current = collectOctopodMigrationSourceCatalog(args.store, args.target)
  const unmoved = unmovedOctopodSourceRows(current, committedOctopodMigrationChain(chain))
  writeOctopodMigrationSourceCutover(args.userDataPath, {
    ...withKeptOctopodSourceRows(head, unmoved),
    // Explicit reconcile accepts the current retained source as the new baseline.
    sourceBaselineFingerprint: octopodCatalogFingerprint(current)
  })
  args.store.updateSshTarget(args.target.id, { octopodFence: { environmentId } })
  await args.claims.flush()
}

function refuse(
  code: string,
  reason: string
): Extract<OctopodDeltaMoveResult, { outcome: 'refused' }> {
  return { outcome: 'refused', code, reason }
}
