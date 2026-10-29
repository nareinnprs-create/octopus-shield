import type { WslOctopodLaunch } from './wsl-octopod-deploy'

type WslOctopodDeferredLaunch = Extract<WslOctopodLaunch, { outcome: 'deferred' }>

/** octopod installed an update it may not activate yet (live terminals); nothing is listening. */
export class WslOctopodLaunchDeferredError extends Error {
  constructor(readonly launch: WslOctopodDeferredLaunch) {
    super(launch.reason)
    this.name = 'WslOctopodLaunchDeferredError'
  }
}

/** A no-boot reconnect found the distro not confirmed running, so nothing was started. */
export class WslDistroNotRunningError extends Error {
  constructor(distro: string) {
    super(
      `The WSL distro ${distro} isn’t running, so Shield didn’t start it for a background request.`
    )
    this.name = 'WslDistroNotRunningError'
  }
}

export class WslOctopodConnectionSupersededError extends Error {
  constructor(distro: string) {
    super(`The connection to the WSL distro ${distro} was closed while it was being opened.`)
    this.name = 'WslOctopodConnectionSupersededError'
  }
}

/** A no-boot connect re-reads the running list just before anything spawns in the distro. */
export async function assertWslDistroMayStart(
  distro: string,
  requireRunning: ((distro: string) => Promise<boolean>) | undefined,
  isCurrent: () => boolean
): Promise<void> {
  if (!requireRunning) {
    return
  }
  const running = await requireRunning(distro)
  // A close during the read supersedes this connect before it deploys anything.
  if (!isCurrent()) {
    throw new WslOctopodConnectionSupersededError(distro)
  }
  if (!running) {
    throw new WslDistroNotRunningError(distro)
  }
}

/** Failures the connection's status must not report as `failed`: liveness owns those verdicts. */
export function isQuietConnectFailure(error: unknown): boolean {
  return (
    error instanceof WslOctopodConnectionSupersededError || error instanceof WslDistroNotRunningError
  )
}
