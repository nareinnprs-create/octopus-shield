import {
  evaluateOctopodActivation,
  type OctopodActivationVerdict
} from '../managed-server/activation/octopod-activation-gate'
import { octopodActivationTransactionRoot } from '../managed-server/activation/octopod-activation-transaction'
import type { OctopodReadinessParse } from '../managed-server/install/octopod-remote-launch'
import {
  launchOctopodAndAwaitReadiness,
  type OctopodRemoteExecTarget
} from '../managed-server/install/octopod-remote-runtime-control'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'

type CandidateLaunchTarget = Parameters<typeof launchOctopodAndAwaitReadiness>[0] &
  OctopodRemoteExecTarget & {
    remoteHome: string
    nodePath: string
    userDataDir: string
    bindHost: string
    port: number
  }

/** Rethrow unconfirmed SSH cleanup: it provides no candidate evidence and must never mean rejection. */
export async function launchAndJudgeOctopodSlot(
  options: CandidateLaunchTarget,
  slot: { remoteInstallDir: string; fullVersion: string; buildHash: string }
): Promise<{ verdict: OctopodActivationVerdict; launchError: unknown }> {
  let parsed: OctopodReadinessParse | null = null
  let launchError: unknown
  try {
    parsed = await launchOctopodAndAwaitReadiness(options, {
      remoteInstallDir: slot.remoteInstallDir,
      nodePath: options.nodePath,
      fullVersion: slot.fullVersion,
      userDataDir: options.userDataDir,
      bindHost: options.bindHost,
      port: options.port,
      activationRoot: octopodActivationTransactionRoot(options.host, options.remoteHome)
    })
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    launchError = error
  }
  const verdict = evaluateOctopodActivation(parsed?.state === 'ready' ? parsed.readiness : null, {
    buildHash: slot.buildHash,
    fullVersion: slot.fullVersion
  })
  return { verdict, launchError }
}
