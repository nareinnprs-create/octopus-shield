import { OctopodBindAddressError } from './octopod-bind-address'
import { OctopodBundledRuntimeError } from './octopod-bundled-runtime'
import { OctopodInstanceLockError } from './octopod-data-root-privacy'
import { ProfileStateAccessError } from '../persistence/profile-state/profile-state-access'
import { OCTOPOD_EXIT_CONFIGURATION } from './octopod-configuration-exit'
import { SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE } from '../../shared/single-instance-exit-code'

export const OCTOPOD_EXIT_FAILED = 1

export function resolveOctopodExitCode(error: unknown): number {
  // Supervisors wait for an existing holder instead of abandoning the host.
  if (
    error instanceof OctopodInstanceLockError &&
    error.code === 'octopod_instance_lock_holder_unverifiable'
  ) {
    return SINGLE_INSTANCE_ALREADY_RUNNING_EXIT_CODE
  }
  return error instanceof OctopodInstanceLockError ||
    error instanceof OctopodBindAddressError ||
    error instanceof OctopodBundledRuntimeError ||
    error instanceof ProfileStateAccessError
    ? OCTOPOD_EXIT_CONFIGURATION
    : OCTOPOD_EXIT_FAILED
}
