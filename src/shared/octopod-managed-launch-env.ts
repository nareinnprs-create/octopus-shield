/** Managed launches alone enable idle exit and name the activation fence that keeps updates/rollbacks alive.
 * Dependency-free so the octopod launcher can read it. */
export const OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV = 'OSHIELD_OCTOPOD_MANAGED_ACTIVATION_ROOT'

/** Host login env naming a machine's own managed-server data on a shared home; clones copy /etc/machine-id. */
export const OSHIELD_MACHINE_NAME_ENV = 'OSHIELD_MACHINE_NAME'
