import { runProcess } from '@shield/process-host'
import type { ArmoryToolDescriptor } from './tool-registry'
import { targetsInScope, type ArmoryScope } from './tool-scope'

export type ArmoryRunRequest = {
  /** Argument vector AFTER the tool binary: flags plus target arguments. */
  args: readonly string[]
  /** Target arguments extracted by the caller — every one must be in scope. */
  targets: readonly string[]
  scope: ArmoryScope
  timeoutMs?: number
  /** Exploitation-class acknowledgment: OSHIELD_ARMORY_EXPLOIT_AUTHORIZED=1. */
  exploitAuthorized?: boolean
}

export type ArmoryRunRecord = {
  toolId: string
  argv: readonly string[]
  targets: readonly string[]
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
  audited: true
}

export type ArmoryRunDenied = { ok: false; reason: string }

export type ArmoryRunResult = { ok: true; record: ArmoryRunRecord } | ArmoryRunDenied

const EXPLOIT_CLASSES = new Set(['exploitation', 'post-exploitation'])

/** Builds the host-side argv per runtime; targets validated BEFORE any process spawns. */
export const buildArgv = (
  tool: ArmoryToolDescriptor,
  args: readonly string[]
): { ok: true; argv: string[] } | { ok: false; reason: string } => {
  if (tool.dockerFullArgv !== undefined && tool.runtime === 'docker') {
    return { ok: true, argv: [...tool.dockerFullArgv, ...args] }
  }
  if (tool.runtime === 'docker') {
    return { ok: true, argv: ['docker', 'run', '--rm', tool.target, ...args] }
  }
  if (tool.runtime === 'wsl') {
    return { ok: true, argv: ['wsl', '-d', 'Ubuntu', '-u', 'root', '-e', tool.target, ...args] }
  }
  if (!osPathLooksAbsolute(tool.target)) {
    return { ok: false, reason: `win tool target must be an absolute path: ${tool.target}` }
  }
  return { ok: true, argv: [tool.target, ...args] }
}

const osPathLooksAbsolute = (p: string): boolean =>
  /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')

export const runArmoryTool = async (
  tool: ArmoryToolDescriptor,
  request: ArmoryRunRequest
): Promise<ArmoryRunResult> => {
  if (tool.status !== 'ok') {
    return { ok: false, reason: `tool ${tool.id} is not installed (status: ${tool.status})` }
  }
  if (!targetsInScope(request.scope, request.targets)) {
    return {
      ok: false,
      reason: `target outside authorized scope: ${request.targets.join(', ') || '(no targets given)'}`
    }
  }
  if (EXPLOIT_CLASSES.has(tool.scopeClass) && request.exploitAuthorized !== true) {
    return {
      ok: false,
      reason: `tool ${tool.id} is ${tool.scopeClass}-class and requires OSHIELD_ARMORY_EXPLOIT_AUTHORIZED=1`
    }
  }
  const argv = buildArgv(tool, request.args)
  if (!argv.ok) {
    return { ok: false, reason: argv.reason }
  }
  const started = Date.now()
  const run = await runProcess({
    program: argv.ok ? argv.argv[0] : '',
    args: argv.argv.slice(1),
    timeoutMs: request.timeoutMs ?? 120_000
  })
  const record: ArmoryRunRecord = {
    toolId: tool.id,
    argv: argv.argv,
    targets: [...request.targets],
    exitCode: run.code,
    timedOut: run.timedOut === true,
    durationMs: Date.now() - started,
    stdout: run.stdout,
    stderr: run.stderr,
    audited: true
  }
  return { ok: true, record }
}
