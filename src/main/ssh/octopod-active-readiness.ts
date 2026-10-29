import {
  evaluateOctopodActivation,
  type OctopodActivationExpectation
} from '../managed-server/activation/octopod-activation-gate'
import {
  octopodLivenessProbeCommand,
  parseOctopodLiveness,
  type OctopodLaunchSpec,
  type OctopodReadinessParse
} from '../managed-server/install/octopod-remote-launch'
import {
  execOctopodRemote,
  launchOctopodAndAwaitReadiness,
  type OctopodRemoteExecTarget
} from '../managed-server/install/octopod-remote-runtime-control'
import {
  parseOctopodReadinessWaitOutput,
  readOctopodReadinessNowCommand
} from '../managed-server/install/octopod-remote-readiness-wait'
import type { ServeReadiness } from '../server/serve-readiness'
import { withOctopodLogTail } from '../managed-server/install/octopod-remote-log-tail'

type OctopodReadinessFailureVerdict = 'exited' | 'unverifiable' | 'rejected'

export class OctopodActiveReadinessError extends Error {
  constructor(
    readonly verdict: OctopodReadinessFailureVerdict,
    message: string
  ) {
    super(message)
    this.name = 'OctopodActiveReadinessError'
  }
}

function gatedReadiness(
  parsed: OctopodReadinessParse,
  expectation: OctopodActivationExpectation,
  label: string
): ServeReadiness {
  const readiness = parsed.state === 'ready' ? parsed.readiness : null
  const verdict = evaluateOctopodActivation(readiness, expectation)
  if (verdict.decision === 'reject') {
    throw new OctopodActiveReadinessError(
      'rejected',
      `${label} failed its readiness check: ${verdict.reason}`
    )
  }
  if (!readiness) {
    throw new OctopodActiveReadinessError(
      'rejected',
      `${label} passed activation without a readiness payload.`
    )
  }
  const coverage = octopodDaemonCoverageRefusal(readiness)
  if (coverage) {
    throw new OctopodActiveReadinessError('rejected', `${label} ${coverage}`)
  }
  return readiness
}

/** Require PTY self-test coverage, or handshake on platforms that cannot spawn-probe. Older slots without coverage metadata retain the identity-only gate. */
function octopodDaemonCoverageRefusal(readiness: ServeReadiness): string | null {
  const health = readiness.health
  const coverage = health?.terminalDaemon?.selfTest?.coverage
  if (!health || coverage === undefined || coverage === 'pty-spawn') {
    return null
  }
  if (coverage === 'handshake' && health.platform === 'win32') {
    return null
  }
  return (
    `reported terminal-daemon coverage '${String(coverage)}', which does not prove a PTY can ` +
    `be created on ${health.platform}.`
  )
}

export async function probeActiveOctopodReadiness(
  target: OctopodRemoteExecTarget & { remoteInstallDir: string },
  expectation: OctopodActivationExpectation
): Promise<ServeReadiness> {
  const liveness = parseOctopodLiveness(
    await execOctopodRemote(target, octopodLivenessProbeCommand(target.host, target.remoteInstallDir))
  )
  if (liveness === 'DEAD') {
    throw new OctopodActiveReadinessError(
      'exited',
      `octopod ${expectation.fullVersion} is recorded active but its process has exited.`
    )
  }
  if (liveness === 'NEVER_LAUNCHED') {
    throw new OctopodActiveReadinessError(
      'exited',
      `octopod ${expectation.fullVersion} is recorded active but was never started from its install directory.`
    )
  }
  if (liveness !== 'LIVE') {
    throw new OctopodActiveReadinessError(
      'unverifiable',
      `octopod ${expectation.fullVersion} process state is unverifiable.`
    )
  }
  const parsed = parseOctopodReadinessWaitOutput(
    target.host,
    await execOctopodRemote(
      target,
      readOctopodReadinessNowCommand(target.host, target.remoteInstallDir)
    )
  )
  return gatedReadiness(parsed, expectation, 'The active octopod')
}

/** Accept recovery/rollback launches only when they prove the expected build. */
export async function launchOctopodSlotAndAwaitReadiness(
  target: OctopodRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: OctopodLaunchSpec,
  expectation: OctopodActivationExpectation
): Promise<ServeReadiness> {
  const parsed = await launchOctopodAndAwaitReadiness(target, spec)
  try {
    return gatedReadiness(parsed, expectation, `octopod ${spec.fullVersion}`)
  } catch (error) {
    if (!(error instanceof OctopodActiveReadinessError)) {
      throw error
    }
    const message = await withOctopodLogTail(target, spec.remoteInstallDir, error.message)
    throw new OctopodActiveReadinessError(error.verdict, message)
  }
}
