/** Read-only export preflight: catalog rows and representable dormant state can migrate; ownership, live leases and untransferred dependencies block. */
import { isLiveSshPtyLease } from '../../../shared/ssh-types'
import type { Store } from '../../persistence'
import type {
  OctopodMigrationBlocker,
  OctopodMigrationPreflight
} from '../../../shared/octopod-migration/octopod-migration-preflight'
import {
  createOctopodMigrationManifest,
  type OctopodMigrationExportStore
} from '../octopod-migration-manifest-export'
import {
  collectTargetCatalogBlockers,
  resolveOctopodPreflightTarget
} from './ssh-target-octopod-claims'
import { collectUntransferredDependentBlockers } from './ssh-target-octopod-dependents'
import {
  preservesOctopodMigrationBridgedPanes,
  type OctopodMigrationPaneLeasePredicate
} from '../octopod-migration-bridged-panes'

export type OctopodMigrationPreflightStore = OctopodMigrationExportStore &
  Pick<
    Store,
    'getSshTarget' | 'getSshRemotePtyLeases' | 'inspectOctopodMigrationUntransferredDependencies'
  >

/** `owner` passes the environment's own fence only when its migration journal is on disk. */
export function preflightOctopodMigrationExport(
  store: OctopodMigrationPreflightStore,
  targetId: string,
  owner?: { environmentId: string; recorded: boolean },
  /** COMPAT(legacy-relay-bridge): leases a bridged proof left running for the bridge. */
  bridgedPtyIds: readonly string[] = []
): OctopodMigrationPreflight {
  const resolved = resolveOctopodPreflightTarget(store, targetId, owner)
  if ('result' in resolved) {
    return resolved.result
  }
  const { target } = resolved
  const blockers: OctopodMigrationBlocker[] = [...collectTargetCatalogBlockers(store, target)]
  const terminalLeases = store
    .getSshRemotePtyLeases(targetId)
    .filter((lease) => isLiveSshPtyLease(lease) && !bridgedPtyIds.includes(lease.ptyId))
    .map(({ ptyId, worktreeId, tabId, leafId, state, updatedAt }) => ({
      ptyId,
      worktreeId,
      tabId,
      leafId,
      state,
      updatedAt
    }))
  if (terminalLeases.length > 0) {
    // A relay PTY cannot move to octopod; its work must finish first.
    blockers.push({
      code: 'octopod_migration_direct_ssh_terminal_leases',
      category: 'live-or-unverifiable',
      terminalLeases
    })
  }
  blockers.push(
    ...collectUntransferredDependentBlockers(store, createOctopodMigrationManifest(store, target))
  )
  return {
    targetId,
    targetLabel: target.label,
    claimable: !blockers.some(isBlockingOctopodMigrationBlocker),
    blockers
  }
}

/** Confirmed Move anyway can leave saved state, but desktop drafts that cannot be left still block. */
export function leaveBehindClearsOctopodMigrationBlockers(
  store: OctopodMigrationPreflightStore & Pick<Store, 'createOctopodMigrationLeaveBehindView'>,
  targetId: string,
  bridgedPtyIds: readonly string[] = [],
  isBridgedPaneLease?: OctopodMigrationPaneLeasePredicate
): boolean {
  const view = store.createOctopodMigrationLeaveBehindView(targetId)
  const preflight = preflightOctopodMigrationExport(
    {
      ...view,
      getSshTarget: (id) => store.getSshTarget(id),
      getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id)
    },
    targetId,
    undefined,
    bridgedPtyIds
  )
  const target = store.getSshTarget(targetId)
  return (
    preflight.claimable &&
    target !== undefined &&
    preservesOctopodMigrationBridgedPanes(
      createOctopodMigrationManifest(view, target).payload,
      store.getSshRemotePtyLeases(targetId),
      bridgedPtyIds,
      isBridgedPaneLease
    )
  )
}

/** Only saved state blocks: a confirmed "Move anyway" may leave it on this desktop. */
export function onlyLeavableOctopodMigrationBlockers(
  blockers: readonly OctopodMigrationBlocker[]
): boolean {
  const blocking = blockers.filter(isBlockingOctopodMigrationBlocker)
  return (
    blocking.length > 0 &&
    blocking.every((blocker) => blocker.code === 'octopod_migration_dependent_state')
  )
}

export function isBlockingOctopodMigrationBlocker(blocker: OctopodMigrationBlocker): boolean {
  return (
    blocker.category !== 'drainable-static-state' &&
    blocker.code !== 'octopod_migration_saved_port_forwards'
  )
}
