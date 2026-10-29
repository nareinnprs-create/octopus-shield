import type {
  PersistedTrustedShieldHookRepo,
  PersistedTrustedShieldHooks
} from './shield-yaml-hook-types'

export type ShieldHookTrustKind = Exclude<keyof PersistedTrustedShieldHookRepo, 'all'>

export function canUseRepoWideTrust(
  trust: PersistedTrustedShieldHooks,
  repos: readonly { id: string }[],
  repoId: string
): boolean {
  // Why: with the id on two hosts, trusting one row's script could run the other's unseen.
  return Boolean(trust[repoId]?.all) && repos.filter((repo) => repo.id === repoId).length < 2
}

/** Returns `trust` itself when the approval is already recorded. */
export function withShieldHookScriptConfirmed(
  trust: PersistedTrustedShieldHooks,
  repoId: string,
  kind: ShieldHookTrustKind,
  contentHash: string,
  approvedAt: number = Date.now()
): PersistedTrustedShieldHooks {
  const existing = trust[repoId]
  if (existing?.[kind]?.contentHash === contentHash) {
    return trust
  }
  return { ...trust, [repoId]: { ...existing, [kind]: { contentHash, approvedAt } } }
}

/** Returns `trust` itself when the repo is already always-trusted. */
export function withShieldHookRepoAlwaysTrusted(
  trust: PersistedTrustedShieldHooks,
  repoId: string,
  approvedAt: number = Date.now()
): PersistedTrustedShieldHooks {
  const existing = trust[repoId]
  if (existing?.all) {
    return trust
  }
  return { ...trust, [repoId]: { ...existing, all: { approvedAt } } }
}
