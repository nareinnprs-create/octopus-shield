import { OCTOPOD_STARTUP_READINESS_TIMEOUT_MS } from '../../../shared/octopod-profile-preflight'
import {
  octopodLaunchCommand,
  parseOctopodReadinessOutput,
  type OctopodLaunchSpec,
  type OctopodReadinessParse
} from './octopod-remote-launch'
import {
  readWindowsOctopodLaunchReport,
  readWindowsOctopodSlotRuntime,
  readWindowsOctopodSlotEntry,
  windowsOctopodLaunchCommand,
  windowsOctopodLaunchRuntimeCommand
} from './octopod-remote-launch-windows'
import {
  OCTOPOD_READINESS_WAIT_MAX_SECONDS,
  octopodLaunchExitedDuringWait,
  octopodReadinessWaitCommand,
  parseOctopodReadinessWaitOutput
} from './octopod-remote-readiness-wait'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'
import { errorMessage } from '../../../shared/error-message'
import {
  execCommand,
  isUnconfirmedSshCommandTermination
} from '../../ssh/remote-exec/remote-exec-command'
import {
  currentOctopodFence,
  isOctopodFenceLost,
  OctopodFenceLostError,
  posixOctopodFenceGuard
} from '../activation/octopod-activation-fence-scope'
import { octopodWindowsHomeOpCommand } from './octopod-remote-windows-node'
import { OCTOPOD_WINDOWS_FENCE_ARG } from '../host-state/octopod-windows-host-fence-ops'
import { isWindowsRemoteHost, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

// Pause even after early host answers to avoid a tight retry loop.
const READINESS_RETRY_PAUSE_MS = 1_000

export type OctopodRemoteExecTarget = {
  conn: OctopodHostTransport
  host: RemoteHostPlatform
  signal?: AbortSignal
  /** Locates the runtime store for host-record scripts; required on Windows, unused elsewhere. */
  remoteHome?: string
}

/** A held activation fence must still name this run before any host step. */
export async function execOctopodRemote(
  target: OctopodRemoteExecTarget,
  command: string,
  signal = target.signal
): Promise<string> {
  const fence = currentOctopodFence()
  const run = (line: string): Promise<string> =>
    execCommand(target.conn, line, {
      wrapCommand: target.host.commandDialect !== 'powershell',
      signal
    })
  try {
    if (!fence) {
      return await run(command)
    }
    if (!isWindowsRemoteHost(target.host)) {
      return await run(`${posixOctopodFenceGuard(fence)} ${command}`)
    }
    // Host ops check ownership internally; other commands need a preceding check.
    if (!command.includes(OCTOPOD_WINDOWS_FENCE_ARG) && target.remoteHome) {
      await run(octopodWindowsHomeOpCommand(target.host, target.remoteHome, 'fence-check', []))
    }
    return await run(command)
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    throw isOctopodFenceLost(error) ? new OctopodFenceLostError() : error
  }
}

/** Only confirmed failures use fallback; unconfirmed failures and lost fences propagate. */
export function execOctopodRemoteOr(
  target: OctopodRemoteExecTarget,
  command: string,
  fallback = ''
): Promise<string> {
  return execOctopodRemote(target, command).catch((error: unknown) => {
    if (isUnconfirmedSshCommandTermination(error) || error instanceof OctopodFenceLostError) {
      throw error
    }
    return fallback
  })
}

/** Recovery paths must finish even when the request that started them was cancelled. */
export function withoutAbortSignal<T extends { signal?: AbortSignal }>(
  options: T
): Omit<T, 'signal'> {
  const { signal: _signal, ...rest } = options
  return rest
}

export async function launchOctopodAndAwaitReadiness(
  target: OctopodRemoteExecTarget & {
    readinessTimeoutMs?: number
    sleep?: (ms: number) => Promise<void>
  },
  spec: OctopodLaunchSpec
): Promise<OctopodReadinessParse> {
  if (isWindowsRemoteHost(target.host)) {
    const slotAnswer = await execOctopodRemote(
      target,
      windowsOctopodLaunchRuntimeCommand(target.host, spec.remoteInstallDir)
    )
    const slotRuntime = readWindowsOctopodSlotRuntime(slotAnswer)
    const slotEntry = readWindowsOctopodSlotEntry(slotAnswer, target.host, spec.remoteInstallDir)
    readWindowsOctopodLaunchReport(
      await execOctopodRemote(
        target,
        windowsOctopodLaunchCommand(target.host, spec, slotRuntime, slotEntry)
      )
    )
  } else {
    await execOctopodRemote(
      target,
      octopodLaunchCommand(
        target.host,
        spec,
        target.conn.octopodLaunchDetach ?? 'nohup',
        (await target.conn.octopodLaunchEnv?.({ fullVersion: spec.fullVersion })) ?? []
      )
    )
  }
  const deadline = Date.now() + (target.readinessTimeoutMs ?? OCTOPOD_STARTUP_READINESS_TIMEOUT_MS)
  const sleep = target.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let last = parseOctopodReadinessOutput('')
  let lastWaitError: unknown
  // Always read once, even if client scheduling outlasted the deadline.
  for (let first = true; first || Date.now() < deadline; first = false) {
    target.signal?.throwIfAborted()
    const waitSeconds = Math.min(
      OCTOPOD_READINESS_WAIT_MAX_SECONDS,
      Math.ceil((deadline - Date.now()) / 1000)
    )
    let output: string
    try {
      output = await execOctopodRemote(
        target,
        octopodReadinessWaitCommand(target.host, spec.remoteInstallDir, waitSeconds)
      )
    } catch (error) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        isUnconfirmedSshCommandTermination(error) ||
        error instanceof OctopodFenceLostError
      ) {
        throw error
      }
      // Failed reads do not prove launch failure; stopping here could kill a healthy candidate.
      lastWaitError = error
      console.warn(`[octopod] readiness wait failed; retrying: ${errorMessage(error)}`)
      await sleep(READINESS_RETRY_PAUSE_MS)
      continue
    }
    target.signal?.throwIfAborted()
    lastWaitError = undefined
    last = parseOctopodReadinessWaitOutput(target.host, output)
    // An exited launch answers as the deadline would, so callers attach the same log tail.
    if (last.state !== 'pending' || octopodLaunchExitedDuringWait(target.host, output)) {
      return last
    }
    await sleep(READINESS_RETRY_PAUSE_MS)
  }
  if (lastWaitError !== undefined) {
    throw lastWaitError
  }
  return last
}
