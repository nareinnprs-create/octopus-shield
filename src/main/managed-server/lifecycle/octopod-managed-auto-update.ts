import {
  planManagedOctopodAutoUpdate,
  type ManagedOctopodAutoUpdateSkip
} from './octopod-managed-update-decision'
import { materializeOctopodArtifact } from '../../octopod/octopod-artifact-materializer'
import {
  OctopodArtifactsUnavailableError,
  OctopodHostUnsupportedError
} from '../../octopod/octopod-host-unavailable'
import { findIncompleteManagedOctopodMigration } from './octopod-managed-migration-status'
import { OCTOPOD_ACTIVATION_FENCE_BUSY_CODE } from '../activation/octopod-activation-fence-hold'
import { resolveLinkedOctopodContext } from './octopod-managed-runtime-context'
import {
  runManagedOctopodUpdate,
  withManagedOctopodLifecycle
} from '../../ssh/octopod-runtime-maintenance'
import type { OctopodUpdateDeferCode } from '../../ssh/octopod-update-plan'
import { readLocalFullVersion } from '../install/remote-versioned-install'

export type ManagedOctopodAutoUpdateOutcome =
  | { outcome: 'skipped'; reason: ManagedOctopodAutoUpdateSkip }
  | { outcome: 'updated'; activeVersion: string }
  | { outcome: 'deferred'; code: string; reason: string }
  /** Candidate rejection or update failure; consult host state before assuming the incumbent serves. */
  | { outcome: 'failed'; reason: string }

const WAITING_CODES: ReadonlySet<string> = new Set<
  OctopodUpdateDeferCode | typeof OCTOPOD_ACTIVATION_FENCE_BUSY_CODE
>([
  OCTOPOD_ACTIVATION_FENCE_BUSY_CODE,
  'octopod_update_terminals_running',
  'octopod_update_terminal_census_unavailable',
  'octopod_update_strands_live_terminals',
  'octopod_update_daemon_protocol_unverifiable',
  'octopod_update_ends_in_process_terminals'
])

/** Temporary deferrals retry on later connects; interrupted activations require recovery. */
export function isWaitingOctopodUpdateDeferral(code: string): boolean {
  return WAITING_CODES.has(code)
}

export function autoUpdateManagedOctopodEnvironment(
  userDataPath: string,
  args: {
    environmentId: string
    appVersion: string
    /** Read under the lifecycle lock to observe prior overlapping attempts. */
    failedBefore: () => boolean
    onUpdating: () => void
  }
): Promise<ManagedOctopodAutoUpdateOutcome> {
  return withManagedOctopodLifecycle(userDataPath, args.environmentId, async (managed) => {
    // Restarting during migration would race cutover staging.
    if (findIncompleteManagedOctopodMigration(userDataPath, managed.environment.id)) {
      return { outcome: 'skipped', reason: 'migrating' }
    }
    const context = await resolveLinkedOctopodContext(managed.environment, managed.deployment)
    const candidateVersion = await bundledManagedOctopodVersion(context.serverTarget)
    const plan = planManagedOctopodAutoUpdate({
      record: context.activationRecord,
      candidateVersion,
      appVersion: args.appVersion,
      failedBefore: args.failedBefore()
    })
    if (plan.action === 'skip') {
      return { outcome: 'skipped', reason: plan.reason }
    }
    args.onUpdating()
    let lockedSkip: ManagedOctopodAutoUpdateSkip | null = null
    try {
      const result = await runManagedOctopodUpdate(userDataPath, managed, context, {
        // Another desktop may activate or stop a newer build during upload; recheck under the fence.
        admitRecord: (record) => {
          const locked = planManagedOctopodAutoUpdate({
            record,
            candidateVersion,
            appVersion: args.appVersion,
            failedBefore: false
          })
          if (locked.action === 'update') {
            return null
          }
          lockedSkip = locked.reason
          return `Auto-update skipped under the host fence: ${locked.reason}.`
        }
      })
      if (lockedSkip) {
        return { outcome: 'skipped', reason: lockedSkip }
      }
      if (result.outcome !== 'deferred') {
        return { outcome: 'updated', activeVersion: result.activeVersion }
      }
      return isWaitingOctopodUpdateDeferral(result.code)
        ? { outcome: 'deferred', code: result.code, reason: result.reason }
        : { outcome: 'failed', reason: result.reason }
    } catch (error) {
      return { outcome: 'failed', reason: error instanceof Error ? error.message : String(error) }
    }
  })
}

type OctopodTarget = Parameters<typeof materializeOctopodArtifact>[0]

// Packaged templates cannot change during this session; avoid repeated hashing.
const bundledVersions = new Map<OctopodTarget, Promise<string | null>>()

/** This build's octopod version for `target`; null when the build bundles none for it. */
export function bundledManagedOctopodVersion(target: OctopodTarget): Promise<string | null> {
  let version = bundledVersions.get(target)
  if (!version) {
    version = materializeOctopodArtifact(target).then(readLocalFullVersion, (error: unknown) => {
      if (
        error instanceof OctopodHostUnsupportedError ||
        error instanceof OctopodArtifactsUnavailableError
      ) {
        return null
      }
      throw error
    })
    // A transient local failure must not stick for the session.
    version.catch(() => bundledVersions.delete(target))
    bundledVersions.set(target, version)
  }
  return version
}

export function resetBundledOctopodVersionsForTests(): void {
  bundledVersions.clear()
}
