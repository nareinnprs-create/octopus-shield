/** Before Add persists its record, removal/disable/startup cannot find the connection or detached holder. Every unsuccessful Add must release both here. */
import { errorMessage } from '../../shared/error-message'
import type { WslHostAddResult } from '../../shared/wsl-host-types'
import { OctopodHostUnsupportedError } from '../octopod/octopod-host-unavailable'
import type { WslHostConnector } from './wsl-host-service'
import { WslOctopodLaunchDeferredError } from './wsl-octopod-connection-errors'
import type { WslOctopodConnection } from './wsl-octopod-connection'

type WslHostAddRefusal = Extract<WslHostAddResult, { ok: false }>
type AddConnector = Pick<WslHostConnector, 'connect' | 'disconnect' | 'releaseHolder'>

export async function abandonWslHostAdd(connector: AddConnector, distro: string): Promise<void> {
  await connector.disconnect(distro).catch(() => {})
  await connector.releaseHolder(distro).catch(() => {})
}

/** `lateRefusal` is re-read once the connect lands: the setting can change while it runs. */
export async function connectForWslHostAdd(
  connector: AddConnector,
  distro: string,
  lateRefusal: () => WslHostAddRefusal | null
): Promise<{ connection: WslOctopodConnection } | WslHostAddRefusal> {
  let connection: WslOctopodConnection
  try {
    connection = await connector.connect(distro)
  } catch (error) {
    await abandonWslHostAdd(connector, distro)
    if (error instanceof WslOctopodLaunchDeferredError) {
      return { ok: false, kind: 'deferred', message: error.launch.reason }
    }
    return {
      ok: false,
      kind: error instanceof OctopodHostUnsupportedError ? 'unsupported-wsl1' : 'failed',
      message: errorMessage(error)
    }
  }
  const refusal = lateRefusal()
  if (refusal) {
    await abandonWslHostAdd(connector, distro)
    return refusal
  }
  return { connection }
}
