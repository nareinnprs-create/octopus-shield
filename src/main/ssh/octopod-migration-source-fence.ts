/** Persist journal, fence, then profile flush before remote calls. Crashes may leave a non-authoritative stale journal; a fence without a journal requires destination evidence before release. */
import { randomUUID } from 'node:crypto'
import { getManagedOctopodFenceEnvironmentId } from '../../shared/managed-octopod-ssh-owner'
import type { OctopodMigrationBlocker } from '../../shared/octopod-migration/octopod-migration-preflight'
import {
  OCTOPOD_MIGRATION_SOURCE_CUTOVER_VERSION,
  type OctopodMigrationSourceCutover
} from '../../shared/octopod-migration/octopod-migration-source-cutover'
import type { SshTarget } from '../../shared/ssh-types'
import {
  assertOctopodMigrationRequestFits,
  createOctopodMigrationManifest
} from './octopod-migration-manifest-export'
import {
  findOctopodMigrationSourceCutoverForTarget,
  removeOctopodMigrationSourceCutover,
  writeOctopodMigrationSourceCutover
} from './octopod-migration-cutover-journal'
import {
  confirmOctopodMigrationTerminalsUnderFence,
  type OctopodMigrationTerminalVerdict
} from './octopod-migration-terminal-gate'
import type { SshTargetOctopodClaims } from './targets/ssh-target-octopod-claims'
import {
  isBlockingOctopodMigrationBlocker,
  preflightOctopodMigrationExport,
  type OctopodMigrationPreflightStore
} from './targets/ssh-target-octopod-preflight'
import { octopodMigrationRefusalReason } from './octopod-migration-refusal-reason'
import {
  preservesOctopodMigrationBridgedPanes,
  type OctopodMigrationPaneLeasePredicate
} from './octopod-migration-bridged-panes'

export const OCTOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS = 'octopod_migration_leave_behind_terminals'
export const OCTOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON =
  'Move anyway needs every terminal on this host closed first, and Shield could not confirm they all exited. Close them, or end them on the host, then connect again.'

export type OctopodMigrationFenceState =
  | { state: 'none' }
  | { state: 'fenced'; cutover: OctopodMigrationSourceCutover }
  /** Empty-host deploys record provisioning intent instead of a migration journal. */
  | { state: 'owned-by-deploy'; environmentId: string }
  /** Unexplained ownership requires recovery, never automatic release. */
  | { state: 'fenced-unverifiable'; environmentId: string }
  /** Stale journals grant no staging authority. */
  | { state: 'stale-journal'; cutover: OctopodMigrationSourceCutover }

/** Throws when the journal cannot be read: an unreadable record keeps the host fenced. */
export function resolveOctopodMigrationFence(
  userDataPath: string,
  target: SshTarget
): OctopodMigrationFenceState {
  const cutover = findOctopodMigrationSourceCutoverForTarget(userDataPath, target.id)
  const ownerEnvironmentId = getManagedOctopodFenceEnvironmentId(target)
  if (cutover) {
    return ownerEnvironmentId === cutover.destinationEnvironmentId &&
      target.generation === cutover.sshTargetGeneration
      ? { state: 'fenced', cutover }
      : { state: 'stale-journal', cutover }
  }
  if (!ownerEnvironmentId) {
    return { state: 'none' }
  }
  return target.octopodProvisioning
    ? { state: 'owned-by-deploy', environmentId: ownerEnvironmentId }
    : { state: 'fenced-unverifiable', environmentId: ownerEnvironmentId }
}

export type OctopodMigrationFenceResult =
  | { outcome: 'fenced'; cutover: OctopodMigrationSourceCutover; resumed: boolean }
  | {
      outcome: 'refused'
      verdict: 'live' | 'unverifiable'
      code: string
      reason: string
      blockers?: OctopodMigrationBlocker[]
    }

export async function fenceOctopodMigrationSource(args: {
  userDataPath: string
  store: OctopodMigrationPreflightStore
  claims: SshTargetOctopodClaims
  targetId: string
  destinationEnvironmentId: string
  destinationName: string
  terminalProof: OctopodMigrationTerminalVerdict
  isBridgedPaneLease?: OctopodMigrationPaneLeasePredicate
  now?: () => Date
  signal?: AbortSignal
}): Promise<OctopodMigrationFenceResult> {
  const target = args.store.getSshTarget(args.targetId)
  if (!target) {
    return refuse('unverifiable', 'octopod_migration_target_not_found', 'The SSH host is gone.')
  }
  const existing = resolveOctopodMigrationFence(args.userDataPath, target)
  if (existing.state === 'fenced') {
    return existing.cutover.destinationEnvironmentId === args.destinationEnvironmentId
      ? { outcome: 'fenced', cutover: existing.cutover, resumed: true }
      : refuse('live', 'octopod_migration_in_progress', 'Another migration holds this SSH host.')
  }
  if (existing.state !== 'none') {
    return refuse(
      'unverifiable',
      `octopod_migration_${existing.state.replaceAll('-', '_')}`,
      fenceStateReason(existing)
    )
  }
  const proof = args.terminalProof
  if (proof.verdict !== 'exited' && proof.verdict !== 'bridged') {
    return refuse(proof.verdict, 'octopod_migration_terminals', proof.reason)
  }
  const preflight = preflightOctopodMigrationExport(
    args.store,
    target.id,
    undefined,
    proof.verdict === 'bridged' ? proof.bridgedPtyIds : []
  )
  if (!preflight.claimable) {
    return {
      ...refuse(
        // Only a proven blocker reads live; one that is merely unanswered stays unverifiable.
        preflight.blockers
          .filter(isBlockingOctopodMigrationBlocker)
          .every((blocker) => blocker.category === 'live-or-unverifiable')
          ? 'unverifiable'
          : 'live',
        'octopod_migration_preflight_blocked',
        octopodMigrationRefusalReason(preflight.blockers)
      ),
      blockers: preflight.blockers
    }
  }
  const generation = args.claims.ensureGeneration(target.id)
  const now = (args.now ?? (() => new Date()))().toISOString()
  const manifest = createOctopodMigrationManifest(
    args.store,
    { ...target, generation },
    { migrationId: randomUUID(), destinationEnvironmentId: args.destinationEnvironmentId }
  )
  if (
    proof.verdict === 'bridged' &&
    target.managedServerLeaveBehind &&
    !preservesOctopodMigrationBridgedPanes(
      manifest.payload,
      args.store.getSshRemotePtyLeases(target.id),
      proof.bridgedPtyIds,
      args.isBridgedPaneLease
    )
  ) {
    return refuse(
      proof.relayVerdict,
      OCTOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS,
      OCTOPOD_MIGRATION_LEAVE_BEHIND_TERMINALS_REASON
    )
  }
  // Reject before journaling so an unsendable manifest cannot pin the fence.
  assertOctopodMigrationRequestFits({ manifest })
  const cutover: OctopodMigrationSourceCutover = {
    version: OCTOPOD_MIGRATION_SOURCE_CUTOVER_VERSION,
    migrationId: manifest.migrationId,
    phase: 'source-fenced',
    startedAt: now,
    updatedAt: now,
    destinationEnvironmentId: args.destinationEnvironmentId,
    destinationName: args.destinationName,
    sshTargetId: target.id,
    sshTargetGeneration: generation,
    manifestSha256: manifest.manifestSha256,
    provenPtyIds: proof.verdict === 'exited' ? proof.provenPtyIds : [],
    ...(proof.verdict === 'bridged' ? { bridgedPtyIds: proof.bridgedPtyIds } : {}),
    // Capture before commit; this journaled export is the evidence of what the destination receives.
    manifest
  }
  writeOctopodMigrationSourceCutover(args.userDataPath, cutover)
  args.claims.fenceForMigration(target.id, args.destinationEnvironmentId, generation)
  await args.claims.flush(args.signal)
  // Recheck under fence for terminals started after the original proof.
  const underFence = confirmOctopodMigrationTerminalsUnderFence(
    args.store,
    target.id,
    args.terminalProof
  )
  if (underFence.verdict !== 'exited' && underFence.verdict !== 'bridged') {
    await releaseUnstagedFence(args, cutover)
    return refuse(underFence.verdict, 'octopod_migration_terminals', underFence.reason)
  }
  return { outcome: 'fenced', cutover, resumed: false }
}

type FenceReleaseArgs = { userDataPath: string; claims: SshTargetOctopodClaims; signal?: AbortSignal }

async function releaseUnstagedFence(
  args: FenceReleaseArgs,
  cutover: OctopodMigrationSourceCutover
): Promise<void> {
  if (cutover.phase !== 'source-fenced') {
    throw new Error('octopod_migration_fence_release_after_stage')
  }
  await releaseOctopodMigrationFence(args, cutover)
}

/** Drop owner before journal so an interrupted release leaves a harmless stale journal, never unexplained ownership. */
export async function releaseOctopodMigrationFence(
  args: FenceReleaseArgs,
  cutover: OctopodMigrationSourceCutover
): Promise<void> {
  args.claims.release(cutover.sshTargetId, cutover.destinationEnvironmentId)
  await args.claims.flush(args.signal)
  removeOctopodMigrationSourceCutover(args.userDataPath, cutover.migrationId)
}

/** Unregistered destinations could stage nothing; registered destinations must prove durable abort instead. */
export async function releaseUndeployedMigrationFence(args: {
  userDataPath: string
  claims: SshTargetOctopodClaims
  targetId: string
  isDestinationRegistered: (environmentId: string) => boolean
  signal?: AbortSignal
}): Promise<'released' | 'none'> {
  const cutover = findOctopodMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  if (!cutover) {
    return 'none'
  }
  if (args.isDestinationRegistered(cutover.destinationEnvironmentId)) {
    throw new Error('octopod_migration_destination_registered')
  }
  await releaseUnstagedFence(args, cutover)
  return 'released'
}

function fenceStateReason(state: OctopodMigrationFenceState): string {
  switch (state.state) {
    case 'owned-by-deploy':
      return 'Shield already runs on this SSH host.'
    case 'fenced-unverifiable':
      return 'This SSH host is held for a migration whose record is missing. Recover it from this host’s Shield server first.'
    case 'stale-journal':
      return 'A migration record names this SSH host but its fence is gone. Resolve that migration first.'
    case 'fenced':
    case 'none':
      return 'This SSH host is not in a state a migration can start from.'
  }
}

function refuse(
  verdict: 'live' | 'unverifiable',
  code: string,
  reason: string
): Extract<OctopodMigrationFenceResult, { outcome: 'refused' }> {
  return { outcome: 'refused', verdict, code, reason }
}
