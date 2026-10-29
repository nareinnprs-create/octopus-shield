import { OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/octopod-managed-launch-env'

type OctopodWsPortOptions = {
  wsPort?: number
  preferPinnedWsPort?: boolean
  requirePinnedWsPort?: boolean
}

/** Honor explicit ports; managed launches permit fallback because WSL distros share loopback. */
export function octopodWsPortOptions(
  port: number | undefined,
  env: NodeJS.ProcessEnv = process.env
): OctopodWsPortOptions {
  if (port === undefined) {
    return {}
  }
  const managed = Boolean(env[OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV])
  return {
    wsPort: port,
    preferPinnedWsPort: true,
    ...(managed ? {} : { requirePinnedWsPort: true })
  }
}
