import type { ServeReadiness } from '../server/serve-readiness'
import type { OctopodManagedStopContext } from '../../shared/octopod-stop-request'

export type OctopodOptions = {
  port?: number
  json?: boolean
  noPairing?: boolean
  pairingAddress?: string
  /** Request a mobile-scoped pairing offer and terminal QR. */
  mobilePairing?: boolean
  grantDesktopControl?: boolean
  /** Print only the ephemeral-VM recipe line. */
  recipeJson?: boolean
  projectRoot?: string
  bind?: string
  /** Slots have no browser client; shield serve supplies the installed app client. */
  webClientRoot?: string
}

export type OctopodHandle = {
  readiness: ServeReadiness
  managedStop: OctopodManagedStopContext
  stop(): Promise<void>
}
