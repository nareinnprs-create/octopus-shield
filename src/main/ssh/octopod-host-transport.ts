import type { SshTarget } from '../../shared/ssh-types'
import type { WslOctopodHostTarget } from '../wsl/wsl-octopod-host-target'
import type { RemoteInstallTransport } from '../managed-server/install/remote-install-transport'
import type { OctopodLaunchDetach } from '../managed-server/install/octopod-remote-launch'

/** Only id/label have the same meaning across host kinds. */
export type OctopodHostTarget = SshTarget | WslOctopodHostTarget

export function isWslOctopodHostTarget(target: OctopodHostTarget): target is WslOctopodHostTarget {
  return 'kind' in target && target.kind === 'wsl'
}

export type OctopodHostTransport = RemoteInstallTransport & {
  getTarget(): OctopodHostTarget
  /** Absent on SSH, which detaches with nohup. */
  readonly octopodLaunchDetach?: OctopodLaunchDetach
  /** Pass client-only host facts at launch; SSH adds none. */
  readonly octopodLaunchEnv?: (
    launch: OctopodLaunchEnvRequest
  ) => Promise<readonly OctopodLaunchEnvEntry[]>
}

/** The slot being launched; entries only its own build understands must check the version. */
export type OctopodLaunchEnvRequest = { readonly fullVersion: string }

/** `keep-existing` applies the value only when the launching shell has none, so a user's own setting wins. */
export type OctopodLaunchEnvEntry = readonly [name: string, value: string, mode?: 'keep-existing']
