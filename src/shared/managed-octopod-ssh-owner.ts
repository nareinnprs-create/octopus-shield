import type { SshTarget, SshTargetOwner } from './ssh-types'

/** The runtime id phase-3 builds wrote into `owner` before the fence moved to `octopodFence`. */
const LEGACY_MANAGED_OCTOPOD_RUNTIME_ID_PREFIX = 'managed-octopod:'

/** The managed Shield server this host serves, or null for a direct SSH host. */
export function getManagedOctopodFenceEnvironmentId(
  target: Pick<SshTarget, 'octopodFence'> | undefined
): string | null {
  return target?.octopodFence?.environmentId || null
}

/** Reads a legacy `owner` fence, only to migrate it to `octopodFence` on load. */
export function getLegacyManagedOctopodOwnerEnvironmentId(
  owner: SshTargetOwner | undefined
): string | null {
  if (!owner?.runtimeId.startsWith(LEGACY_MANAGED_OCTOPOD_RUNTIME_ID_PREFIX)) {
    return null
  }
  return owner.runtimeId.slice(LEGACY_MANAGED_OCTOPOD_RUNTIME_ID_PREFIX.length) || null
}

export function isEphemeralRuntimeSshOwner(owner: SshTargetOwner | undefined): boolean {
  return (
    owner?.type === 'on-demand-runtime' && getLegacyManagedOctopodOwnerEnvironmentId(owner) === null
  )
}

/** Every VM a recipe makes shares its label, so the runtime id keeps their server names unique. */
export function managedOctopodServerName(target: Pick<SshTarget, 'label' | 'owner'>): string {
  const runtimeId = isEphemeralRuntimeSshOwner(target.owner) ? target.owner?.runtimeId : undefined
  return runtimeId ? `${target.label} VM ${runtimeId.slice(-8)}` : target.label
}
