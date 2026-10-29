// Open forwards prove no identity; require an authenticated status call from the pinned server.
import { parsePairingCode } from '../../../shared/pairing'
import {
  pairedRuntimeConnectionFromOffer,
  type PairedRuntimeConnection
} from '../../../shared/paired-runtime-connection'
import { OCTOPOD_MANAGED_REMOTE_PORT } from '../../../shared/octopod-managed-runtime'
import {
  isRecoverableRemoteRuntimeConnectionError,
  toRemoteRuntimeClientErrorLike
} from '../../../shared/remote-runtime/remote-runtime-client-error-classification'
import { RemoteRuntimeClientError } from '../../../shared/remote-runtime/remote-runtime-client-error'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../../shared/runtime-environments'
import { verifyRuntimePairingIdentity } from '../../runtime/runtime-environment-identity-verification'
import type { ServeReadiness } from '../../server/serve-readiness'
import { octopodBoundPort } from './octopod-managed-bound-port'
import { tunneledOctopodPairingCode } from '../../ssh/octopod-tunneled-pairing'

/** Unreachable proves no identity; unpaired is a refusal sealed by the pinned server key. */
export type OctopodTunnelIdentity =
  | { verdict: 'verified' }
  | { verdict: 'foreign' | 'unreachable' | 'unpaired'; detail: string }

export const OCTOPOD_IDENTITY_MISMATCH_CODE = 'octopod_identity_mismatch'

export class OctopodManagedIdentityError extends Error {
  readonly code = OCTOPOD_IDENTITY_MISMATCH_CODE
  constructor(remotePort: number, detail: string) {
    super(
      `${OCTOPOD_IDENTITY_MISMATCH_CODE}: the server on remote port ${remotePort} is not this ` +
        `host’s Shield server (another Shield may be using that port): ${detail}`
    )
    this.name = 'OctopodManagedIdentityError'
  }
}

export const OCTOPOD_PAIRING_REJECTED_CODE = 'octopod_pairing_rejected'

export class OctopodManagedPairingRejectedError extends Error {
  readonly code = OCTOPOD_PAIRING_REJECTED_CODE
  constructor(detail: string) {
    super(
      `${OCTOPOD_PAIRING_REJECTED_CODE}: this host’s Shield server no longer accepts ` +
        `this desktop's pairing (its saved devices were reset, or this desktop was removed ` +
        `there), so reconnecting alone won't restore access: ${detail}`
    )
    this.name = 'OctopodManagedPairingRejectedError'
  }
}

export function octopodIdentityRefusal(
  remotePort: number,
  identity: Exclude<OctopodTunnelIdentity, { verdict: 'verified' }>
): Error {
  return identity.verdict === 'unpaired'
    ? new OctopodManagedPairingRejectedError(identity.detail)
    : new OctopodManagedIdentityError(remotePort, identity.detail)
}

// Key rejection closes the socket instead of returning a status reply.
const FOREIGN_CLOSE_CODES = new Set([4001, 4003])

export function classifyOctopodTunnelIdentityFailure(error: unknown): OctopodTunnelIdentity {
  const detail = error instanceof Error ? error.message : String(error)
  // Only sealed access-grant refusals prove the pinned server answered.
  if (
    error instanceof RemoteRuntimeClientError &&
    error.code === 'unauthorized' &&
    error.pairingStage === 'access-grant'
  ) {
    return { verdict: 'unpaired', detail }
  }
  if (error instanceof RemoteRuntimeClientError && FOREIGN_CLOSE_CODES.has(error.closeCode ?? 0)) {
    return { verdict: 'foreign', detail }
  }
  return isRecoverableRemoteRuntimeConnectionError(toRemoteRuntimeClientErrorLike(error))
    ? { verdict: 'unreachable', detail }
    : { verdict: 'foreign', detail }
}

export async function verifyOctopodPairingIdentity(
  connection: PairedRuntimeConnection,
  expected: Pick<KnownRuntimeEnvironment, 'runtimeId' | 'pairedDeviceId'>
): Promise<OctopodTunnelIdentity> {
  try {
    await verifyRuntimePairingIdentity(connection, expected)
    return { verdict: 'verified' }
  } catch (error) {
    return classifyOctopodTunnelIdentityFailure(error)
  }
}

export function verifyManagedOctopodTunnelIdentity(
  environment: KnownRuntimeEnvironment
): Promise<OctopodTunnelIdentity> {
  if (!environment.octopodDeployment) {
    return Promise.resolve({ verdict: 'verified' })
  }
  // Runtime/device IDs can change or become stale; pinned-key handshake and token acceptance prove identity.
  return verifyOctopodPairingIdentity(getPreferredPairedRuntimeConnection(environment), {
    runtimeId: null
  })
}

/** Fresh deploys have no saved pairing; reread readiness after foreign answers to follow port changes. */
export function deployedOctopodTunnelChecks(
  initial: ServeReadiness,
  rereadReadiness: () => Promise<ServeReadiness>
) {
  let readiness = initial
  return {
    readiness: () => readiness,
    remotePort: octopodBoundPort(initial) ?? OCTOPOD_MANAGED_REMOTE_PORT,
    rereadRemotePort: async () => {
      readiness = await rereadReadiness()
      return octopodBoundPort(readiness) ?? OCTOPOD_MANAGED_REMOTE_PORT
    },
    verify: async (localPort: number): Promise<OctopodTunnelIdentity> => {
      const pairing = parsePairingCode(tunneledOctopodPairingCode(readiness, localPort))
      return pairing
        ? verifyOctopodPairingIdentity(pairedRuntimeConnectionFromOffer(pairing), {
            runtimeId: readiness.runtimeId || null
          })
        : { verdict: 'foreign', detail: 'This host’s Shield server published an invalid pairing.' }
    }
  }
}
