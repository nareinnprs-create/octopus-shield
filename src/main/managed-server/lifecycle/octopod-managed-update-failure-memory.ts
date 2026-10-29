// Remember failures only for this session so restarting retries once.
export type OctopodUpdateFailureHost = { kind: 'ssh' | 'wsl'; id: string }

export type OctopodUpdateFailure = { code: string; reason: string }

const failedThisLaunch = new Map<string, OctopodUpdateFailure>()

function key(host: OctopodUpdateFailureHost): string {
  return `${host.kind}:${host.id}`
}

export function recordOctopodUpdateFailedThisLaunch(
  host: OctopodUpdateFailureHost,
  failure: OctopodUpdateFailure
): void {
  failedThisLaunch.set(key(host), failure)
}

export function octopodUpdateFailureThisLaunch(
  host: OctopodUpdateFailureHost
): OctopodUpdateFailure | null {
  return failedThisLaunch.get(key(host)) ?? null
}

export function octopodUpdateFailedThisLaunch(host: OctopodUpdateFailureHost): boolean {
  return failedThisLaunch.has(key(host))
}

export function clearOctopodUpdateFailedThisLaunch(host: OctopodUpdateFailureHost): void {
  failedThisLaunch.delete(key(host))
}

export function resetOctopodUpdateFailuresForTests(): void {
  failedThisLaunch.clear()
}
