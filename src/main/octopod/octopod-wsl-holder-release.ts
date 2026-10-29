/**
 * Lets a WSL distro stop once its octopod idle-stops with nothing left to keep (R40). The desktop's
 * holder keeps the distro up; it reads this request and ends after octopod's pid exits.
 */
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { OCTOPOD_WSL_HOLDER_RELEASE_FILENAME } from '../../shared/octopod-idle-exit'
import { writeSecureFile } from '../../shared/secure-file'
import { OCTOPOD_WSL_HOST_ENV } from '../ipc/wsl-guest-windows-drive-path'
import type { OctopodDaemonRetirement } from './octopod-daemon-retirement'

export function octopodWslHolderReleasePath(userDataPath: string): string {
  return join(userDataPath, OCTOPOD_WSL_HOLDER_RELEASE_FILENAME)
}

/**
 * Only a WSL-host launch has a holder, and only a daemon that proved itself empty and left shows
 * no terminal would die with the distro. Why the launch marker: a setsid'd octopod may lack WSL_DISTRO_NAME.
 */
export function idleStopMayReleaseWslHolder(
  env: NodeJS.ProcessEnv,
  daemon: OctopodDaemonRetirement
): boolean {
  return env[OCTOPOD_WSL_HOST_ENV] === '1' && daemon.retirement === 'retired'
}

export function requestOctopodWslHolderRelease(userDataPath: string, pid = process.pid): void {
  writeSecureFile(octopodWslHolderReleasePath(userDataPath), `${pid}\n`)
}

/**
 * A starting octopod may be given work, so any earlier request no longer stands. WSL-host launches
 * only; never throws, so a locked or unwritable data root cannot fail a start or a stop.
 */
export function withdrawOctopodWslHolderRelease(
  userDataPath: string,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (env[OCTOPOD_WSL_HOST_ENV] !== '1') {
    return
  }
  try {
    rmSync(octopodWslHolderReleasePath(userDataPath), { force: true })
  } catch (error) {
    console.error('[octopod] could not withdraw the WSL holder release request:', error)
  }
}
