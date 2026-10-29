import { OCTOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND } from '../../shared/octopod-migration/octopod-migration-source-kind'
import type { SshTarget } from '../../shared/ssh-types'
import { collectOctopodMigrationSourceCatalog } from '../persistence/migrating-octopod-catalog/octopod-source-catalog'
import type { Store } from '../persistence'
import { createOctopodMigrationManifest } from './octopod-migration-manifest-export'
import { IDENTITY_OCTOPOD_MIGRATION_PATH_REWRITER } from './octopod-migration-path-rewrite'
import type {
  OctopodMigrationSource,
  OctopodMigrationSourceCutoverPort
} from './octopod-migration-source'
import { assertOctopodMigrationSourceUnchanged } from './octopod-migration-source-assertions'
import {
  fenceOctopodMigrationSource,
  releaseOctopodMigrationFence,
  resolveOctopodMigrationFence
} from './octopod-migration-source-fence'
import {
  assessOctopodMigrationTerminals,
  retireProvenExitedLeases,
  type CensusHostRelayTerminals
} from './octopod-migration-terminal-gate'
import type { SshTargetOctopodClaims } from './targets/ssh-target-octopod-claims'
import type { OctopodMigrationPreflightStore } from './targets/ssh-target-octopod-preflight'
import type { OctopodMigrationPaneLeasePredicate } from './octopod-migration-bridged-panes'

type SshRelayCutoverDeps = {
  userDataPath: string
  store: OctopodMigrationPreflightStore
  claims: SshTargetOctopodClaims
  /** Rebuild copied stores for every check so later edits remain visible. */
  freshSource?: () => OctopodMigrationPreflightStore
  signal?: AbortSignal
}

export function sshRelayMigrationCutoverPort(
  deps: SshRelayCutoverDeps
): OctopodMigrationSourceCutoverPort {
  return {
    verifyFence: (cutover) =>
      assertOctopodMigrationSourceUnchanged(
        { userDataPath: deps.userDataPath, store: deps.freshSource?.() ?? deps.store },
        cutover
      ),
    releaseFence: (cutover) => releaseOctopodMigrationFence(deps, cutover)
  }
}

export function createSshRelayMigrationSource(
  deps: SshRelayCutoverDeps & {
    store: OctopodMigrationPreflightStore &
      Pick<Store, 'getSshRemotePtyLeases' | 'markSshRemotePtyLease'>
    target: SshTarget
    /** Every relay endpoint on the host's account; without it exit can never be proven. */
    censusHost?: CensusHostRelayTerminals | null
    isBridgedPaneLease?: OctopodMigrationPaneLeasePredicate
  }
): OctopodMigrationSource {
  const { userDataPath, store, target } = deps
  return {
    ...sshRelayMigrationCutoverPort(deps),
    kind: OCTOPOD_MIGRATION_SSH_RELAY_SOURCE_KIND,
    journalKey: target.id,
    collectCatalog: () => collectOctopodMigrationSourceCatalog(store, target),
    exportManifest: (options = {}) =>
      createOctopodMigrationManifest(store, target, {
        ...options,
        rewrite: IDENTITY_OCTOPOD_MIGRATION_PATH_REWRITER
      }),
    assessTerminals: () => assessOctopodMigrationTerminals(store, target.id, deps.censusHost),
    retireProvenExitedTerminals: (proof) => retireProvenExitedLeases(store, target.id, proof),
    resolveFence: () => resolveOctopodMigrationFence(userDataPath, target),
    acquireFence: (args) =>
      fenceOctopodMigrationSource({
        userDataPath,
        store,
        claims: deps.claims,
        targetId: target.id,
        isBridgedPaneLease: deps.isBridgedPaneLease,
        ...args
      })
  }
}
