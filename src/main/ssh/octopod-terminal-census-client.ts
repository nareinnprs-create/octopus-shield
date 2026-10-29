/** Unknown failures, including older hosts without census support, stay unverifiable and never mean zero live terminals. */
import { OCTOPOD_TERMINAL_CENSUS_RUNTIME_CAPABILITY } from '../../shared/octopod-runtime-capabilities'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/electron-remote-runtime-client-capabilities'
import type { PairedRuntimeConnection } from '../../shared/paired-runtime-connection'
import {
  getPreferredPairedRuntimeConnection,
  type KnownRuntimeEnvironment
} from '../../shared/runtime-environments'
import {
  OCTOPOD_TERMINAL_CENSUS_METHOD,
  OctopodTerminalCensusSchema,
  type OctopodTerminalCensus,
  UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
} from '../../shared/octopod-terminal-census'
import { sendRemoteRuntimeRequestWithStatusPreflight } from '../../shared/remote-runtime/remote-runtime-client'
import type { OctopodActivationRecord } from '../managed-server/activation/octopod-activation-record'
import { ensureOctopodManagedTunnel } from '../managed-server/lifecycle/octopod-managed-tunnel'
import { verifyOctopodManagedServing } from '../managed-server/lifecycle/octopod-managed-serving-verify'

export type OctopodTerminalCensusRequestOptions = {
  releaseFinishedAutomationTerminals?: boolean
  /** Close the server's terminal admission this long before counting; 0 reopens it. */
  closeAdmissionForMs?: number
}

/** Wake idle servers behind ensured tunnels; failed wake/tunnel stays unverifiable. */
export async function collectManagedTerminalCensus(
  userDataPath: string,
  environment: KnownRuntimeEnvironment,
  record: OctopodActivationRecord,
  timeoutMs = 15_000,
  options: OctopodTerminalCensusRequestOptions = {}
): Promise<OctopodTerminalCensus> {
  if (!record.active) {
    return { liveSessions: 0, startedSinceActivation: 0, daemonProtocolVersion: null }
  }
  const activatedAt = record.activatedAt ? Date.parse(record.activatedAt) : Number.NaN
  if (!Number.isFinite(activatedAt) || activatedAt < 0) {
    return UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
  }
  try {
    // Use the tunnel's returned pairing; re-pairing may have retired the caller's token.
    const current = await ensureOctopodManagedTunnel(userDataPath, environment.id)
    // Wake before census, except for reopen: a stopped server has no admission to release.
    if (options.closeAdmissionForMs !== 0) {
      await verifyOctopodManagedServing(userDataPath, environment.id)
    }
    return await requestOctopodTerminalCensus(
      getPreferredPairedRuntimeConnection(current),
      activatedAt,
      timeoutMs,
      options
    )
  } catch {
    return UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
  }
}

export async function requestOctopodTerminalCensus(
  connection: PairedRuntimeConnection,
  activatedAt: number,
  timeoutMs = 15_000,
  options: OctopodTerminalCensusRequestOptions = {}
): Promise<OctopodTerminalCensus> {
  try {
    const response = await sendRemoteRuntimeRequestWithStatusPreflight<unknown>(
      connection,
      OCTOPOD_TERMINAL_CENSUS_METHOD,
      {
        activatedAt,
        ...(options.releaseFinishedAutomationTerminals
          ? { releaseFinishedAutomationTerminals: true }
          : {}),
        // Older servers safely omit both unsupported admission request and reply fields.
        ...(options.closeAdmissionForMs === undefined
          ? {}
          : { closeAdmissionForMs: options.closeAdmissionForMs })
      },
      timeoutMs,
      (status) => {
        if (
          !status.ok ||
          !status.result.capabilities?.includes(OCTOPOD_TERMINAL_CENSUS_RUNTIME_CAPABILITY)
        ) {
          throw new Error('This host’s Shield server does not report a terminal census.')
        }
      },
      undefined,
      ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES
    )
    return response.ok
      ? OctopodTerminalCensusSchema.parse(response.result)
      : UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
  } catch {
    return UNVERIFIABLE_OCTOPOD_TERMINAL_CENSUS
  }
}
