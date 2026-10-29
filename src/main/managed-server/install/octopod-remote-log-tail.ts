// Decorate logged errors with a bounded redacted host tail, never telemetry; missing host evidence preserves the original failure.
import { redactString } from '../../observability/redactor'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { OCTOPOD_LOG_FILENAME } from './octopod-remote-host-support'
import { execCommand } from '../../ssh/remote-exec/remote-exec-command'
import {
  isWindowsRemoteHost,
  joinRemotePath,
  type RemoteHostPlatform
} from '../../ssh/ssh-remote-platform'
import {
  octopodWindowsSlotOpCommand,
  readOctopodWindowsEncodedAnswer
} from './octopod-remote-windows-node'
import { OCTOPOD_WINDOWS_LOG_TAIL_MARKER } from '../host-state/octopod-windows-host-script'
import type { OctopodRemoteExecTarget } from './octopod-remote-runtime-control'

export const OCTOPOD_LOG_TAIL_LINES = 40
export const OCTOPOD_LOG_TAIL_MAX_BYTES = 8 * 1024
// Error decoration must not add an unbounded delay.
const OCTOPOD_LOG_TAIL_TIMEOUT_MS = 10_000

export function octopodLogTailCommand(host: RemoteHostPlatform, slotDir: string): string {
  const log = joinRemotePath(host, slotDir, OCTOPOD_LOG_FILENAME)
  if (isWindowsRemoteHost(host)) {
    return octopodWindowsSlotOpCommand(host, slotDir, 'log-tail', [
      log,
      String(OCTOPOD_LOG_TAIL_MAX_BYTES)
    ])
  }
  return `tail -c ${OCTOPOD_LOG_TAIL_MAX_BYTES} ${quotePosixShell(log)} 2>/dev/null || true`
}

export function parseOctopodLogTail(host: RemoteHostPlatform, output: string): string | null {
  const raw = isWindowsRemoteHost(host)
    ? (readOctopodWindowsEncodedAnswer(output, OCTOPOD_WINDOWS_LOG_TAIL_MARKER) ?? '')
    : output
  const bounded = Buffer.from(raw, 'utf8').subarray(-OCTOPOD_LOG_TAIL_MAX_BYTES).toString('utf8')
  const lines = bounded.replace(/\s+$/u, '').split(/\r?\n/u).slice(-OCTOPOD_LOG_TAIL_LINES)
  const tail = redactString(lines.join('\n'))
  return tail.trim() ? tail : null
}

async function readOctopodLogTail(
  target: OctopodRemoteExecTarget,
  slotDir: string
): Promise<string | null> {
  try {
    // Observe cancellation failures without reusing the already-aborted request signal.
    const output = await execCommand(target.conn, octopodLogTailCommand(target.host, slotDir), {
      wrapCommand: target.host.commandDialect !== 'powershell',
      timeoutMs: OCTOPOD_LOG_TAIL_TIMEOUT_MS
    })
    return parseOctopodLogTail(target.host, output)
  } catch (error) {
    console.warn('[ssh] Could not read the octopod.log tail:', error)
    return null
  }
}

export async function withOctopodLogTail(
  target: OctopodRemoteExecTarget,
  slotDir: string,
  message: string
): Promise<string> {
  const tail = await readOctopodLogTail(target, slotDir)
  return tail ? `${message}\nLast lines of octopod.log:\n${tail}` : message
}
