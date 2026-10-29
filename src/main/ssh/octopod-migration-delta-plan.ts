/** Subtract earlier migrations' currently retained rows/state; export only additions. Never merge overlapping old source copies over server-owned state. */
import type { OctopodDeltaMovePreview, OctopodDeltaMoveRow } from '../../shared/octopod-managed-runtime'
import type {
  OctopodMigrationCatalogPayload,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'
import { isRetainedOctopodMigrationSourceCutover } from '../../shared/octopod-migration/octopod-migration-source-cutover'
import type { OctopodMigrationSourceCutover } from '../../shared/octopod-migration/octopod-migration-source-cutover'
import type { SshTarget } from '../../shared/ssh-types'
import type { Store } from '../persistence'
import { collectOctopodMigrationSourceCatalog } from '../persistence/migrating-octopod-catalog/octopod-source-catalog'
import { listOctopodMigrationCutoverChainForTarget } from './octopod-migration-cutover-journal'
import {
  createOctopodMigrationManifest,
  octopodMigrationCatalogIds,
  type OctopodMigrationCatalogIds
} from './octopod-migration-manifest-export'
import type { OctopodMigrationSnapshotSource } from './octopod-migration-snapshot-coordinator'
import { collectUntransferredDependentBlockers } from './targets/ssh-target-octopod-dependents'
import type { OctopodMigrationPreflightStore } from './targets/ssh-target-octopod-preflight'

export type OctopodDeltaSourceStore = OctopodMigrationPreflightStore & OctopodMigrationSnapshotSource

export function unfinishedOctopodDelta(
  chain: readonly OctopodMigrationSourceCutover[]
): OctopodMigrationSourceCutover | null {
  const head = chain.at(-1)
  return head?.supersedesMigrationId &&
    head.phase !== 'source-retired' &&
    !isRetainedOctopodMigrationSourceCutover(head)
    ? head
    : null
}

export function committedOctopodMigrationChain(
  chain: readonly OctopodMigrationSourceCutover[]
): OctopodMigrationSourceCutover[] {
  return (unfinishedOctopodDelta(chain) ? chain.slice(0, -1) : chain).filter(
    (cutover) => cutover.phase === 'destination-committed' || cutover.phase === 'source-retired'
  )
}

export function octopodDeltaSourceStore(
  store: Store,
  target: SshTarget,
  moved: readonly OctopodMigrationSourceCutover[],
  /** Older interrupted deltas may still include server-owned groups. */
  journaled?: OctopodMigrationManifest
): OctopodDeltaSourceStore {
  const ids = octopodMigrationCatalogIds(moved.map((cutover) => cutover.manifest.payload))
  // Never move projects/groups already owned through earlier links.
  const linked = moved.flatMap((cutover) => cutover.linkedRepositoryIds ?? [])
  const linkedGroups = moved.flatMap((cutover) => cutover.linkedProjectGroupIds ?? [])
  const linkedFolders = moved.flatMap((cutover) => cutover.linkedFolderWorkspaceIds ?? [])
  // New rows reference server-owned groups; exporting retained copies could overwrite newer server edits.
  const serverGroups = new Set([...ids.projectGroupIds, ...linkedGroups])
  const exported = new Set(journaled?.payload.projectGroups.map((group) => group.id))
  return octopodSourceStoreWithout(
    store,
    target,
    {
      ...ids,
      repositoryIds: new Set([...ids.repositoryIds, ...linked]),
      folderWorkspaceIds: new Set([...ids.folderWorkspaceIds, ...linkedFolders]),
      projectGroupIds: serverGroups
    },
    moved.at(-1)?.destinationEnvironmentId,
    new Set([...serverGroups].filter((id) => !exported.has(id)))
  )
}

export function octopodSourceStoreWithout(
  store: Store,
  target: SshTarget,
  owned: OctopodMigrationCatalogIds,
  destinationEnvironmentId: string | undefined,
  /** Groups the server's record wins for: never exported, even while a moving row sits in one. */
  serverGroupIds: ReadonlySet<string> = new Set()
): OctopodDeltaSourceStore {
  const ownedNow = createOctopodMigrationManifest(store, target, {
    destinationEnvironmentId,
    onlyCatalog: owned
  })
  const view = store.createOctopodMigrationDeltaView(ownedNow)
  return {
    ...view,
    serverOwnedProjectGroupIds: serverGroupIds,
    getSshTarget: (id) => store.getSshTarget(id),
    getSshRemotePtyLeases: (id) => store.getSshRemotePtyLeases(id),
    readOctopodMigrationSourceSnapshotChunk: (...args) =>
      store.readOctopodMigrationSourceSnapshotChunk(...args)
  }
}

export type OctopodDeltaMovePlan = OctopodDeltaMovePreview & {
  manifest: OctopodMigrationManifest
  moved: OctopodMigrationSourceCutover[]
  head: OctopodMigrationSourceCutover
  resumes: OctopodMigrationSourceCutover | null
  source: OctopodDeltaSourceStore
}

export function planOctopodDeltaMove(
  userDataPath: string,
  store: Store,
  target: SshTarget,
  options: { migrationId?: string; now?: () => Date } = {}
): OctopodDeltaMovePlan {
  const environmentId = target.octopodFence?.environmentId
  if (!environmentId || !target.octopodFence?.sourceChangedAt) {
    throw new Error('octopod_delta_not_changed')
  }
  const chain = listOctopodMigrationCutoverChainForTarget(userDataPath, target.id)
  const resumes = unfinishedOctopodDelta(chain)
  const moved = committedOctopodMigrationChain(chain)
  const head = chain.at(resumes ? -2 : -1)
  if (
    !head ||
    !isRetainedOctopodMigrationSourceCutover(head) ||
    moved.at(-1)?.migrationId !== head.migrationId
  ) {
    throw new Error('octopod_delta_no_retained_migration')
  }
  const source = octopodDeltaSourceStore(store, target, moved, resumes?.manifest)
  const manifest =
    resumes?.manifest ??
    createOctopodMigrationManifest(source, target, {
      migrationId: options.migrationId,
      now: options.now,
      destinationEnvironmentId: environmentId
    })
  const current = collectOctopodMigrationSourceCatalog(store, target)
  return {
    sshTargetId: target.id,
    environmentId,
    added: catalogRows(manifest.payload),
    notReflected: notReflected(
      current,
      moved.map((cutover) => cutover.manifest.payload)
    ),
    blockers: collectUntransferredDependentBlockers(source, manifest),
    manifest,
    moved,
    head,
    resumes,
    source
  }
}

function catalogRows(catalog: OctopodMigrationCatalogPayload): OctopodDeltaMoveRow[] {
  return [
    ...catalog.repositories.map((row) => ({
      kind: 'repository' as const,
      id: row.id,
      label: row.displayName
    })),
    ...catalog.folderWorkspaces.map((row) => ({
      kind: 'folder-workspace' as const,
      id: row.id,
      label: row.name
    })),
    ...catalog.projectGroups.map((row) => ({
      kind: 'project-group' as const,
      id: row.id,
      label: row.name
    }))
  ]
}

/** Rows earlier migrations moved that an older build has since changed or removed. */
function notReflected(
  current: OctopodMigrationCatalogPayload,
  movedPayloads: readonly OctopodMigrationCatalogPayload[]
): OctopodDeltaMovePreview['notReflected'] {
  const latestMoved = new Map<string, { row: OctopodDeltaMoveRow; identity: string }>()
  for (const payload of movedPayloads) {
    for (const row of catalogRows(payload)) {
      latestMoved.set(`${row.kind}:${row.id}`, { row, identity: identityOf(payload, row) })
    }
  }
  const currentByKey = new Map(
    catalogRows(current).map((row) => [`${row.kind}:${row.id}`, identityOf(current, row)])
  )
  const edited: OctopodDeltaMoveRow[] = []
  const removed: OctopodDeltaMoveRow[] = []
  for (const [key, moved] of latestMoved) {
    const identity = currentByKey.get(key)
    if (identity === undefined) {
      removed.push(moved.row)
    } else if (identity !== moved.identity) {
      edited.push(moved.row)
    }
  }
  return { edited, removed }
}

function identityOf(catalog: OctopodMigrationCatalogPayload, row: OctopodDeltaMoveRow): string {
  switch (row.kind) {
    case 'repository': {
      const repo = catalog.repositories.find((entry) => entry.id === row.id)
      return `${repo?.path}\0${repo?.displayName}`
    }
    case 'folder-workspace': {
      const folder = catalog.folderWorkspaces.find((entry) => entry.id === row.id)
      return `${folder?.folderPath}\0${folder?.name}`
    }
    case 'project-group':
      return catalog.projectGroups.find((entry) => entry.id === row.id)?.name ?? ''
  }
}
