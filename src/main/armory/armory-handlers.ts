import { ipcMain, app, type IpcMainInvokeEvent } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { runProcess } from '@shield/process-host'
import {
  armoryInventoryDir,
  loadToolInventory,
  toolInventoryLoadPaths
} from '@shield/armory/inventory'
import { discoverTools, writeDiscoveredInventory } from '@shield/armory/discovery'
import { buildArgv, runArmoryTool } from '@shield/armory/tool-runner'
import { scopeFromEnv } from '@shield/armory/tool-scope'
import { armoryRunAuditEvent } from '@shield/armory/armory-audit'
import type { ArmoryToolDescriptor } from '@shield/armory/tool-registry'
import type {
  ArmoryHealthEntry,
  ArmoryHealthReport,
  ArmoryRunIpcRequest,
  ArmoryRunOutcome,
  ArmoryScopeState,
  ArmorySetupItem,
  ArmorySetupState,
  ArmoryToolView
} from '../../shared/armory-contract'
import { ArmoryRunIpcRequestSchema } from '../../shared/armory-contract'
import { isTrustedUIRenderer } from '../ipc/ui'

const HEALTH_PROBE_TIMEOUT_MS = 8_000
const DETAIL_MAX_CHARS = 80

export type ArmoryHandlerDeps = {
  env: Readonly<Record<string, string | undefined>>
  listTools: () => readonly ArmoryToolDescriptor[]
  /** Best-effort first-run tool discovery; list handlers await it so fresh devices self-populate. */
  ensureDiscovered?: () => Promise<void>
  /** Resolved userData inventory dir (setup reporting). */
  inventoryDir?: string
  runVersionProbe: (
    program: string,
    args: readonly string[],
    timeoutMs: number
  ) => Promise<{ code: number | null; stdout: string; stderr: string; timedOut?: boolean }>
}

const defaultArmoryHandlerDeps = (): ArmoryHandlerDeps => {
  const userDataPath = app.getPath('userData')
  const shippedInventoryDir = app.isPackaged
    ? join(process.resourcesPath, 'armory', 'inventory')
    : join(app.getAppPath(), 'resources', 'armory', 'inventory')
  const inventoryDir = armoryInventoryDir({ userDataPath, env: process.env })
  let discoveryOnce: Promise<void> | null = null
  return {
    env: process.env,
    listTools: () =>
      loadToolInventory(
        toolInventoryLoadPaths({ userDataPath, env: process.env, shippedInventoryDir })
      ),
    inventoryDir,
    ensureDiscovered: () => {
      discoveryOnce ??= discoverTools(process.platform, process.env)
        .then((tools) => {
          writeDiscoveredInventory({ userDataPath, env: process.env }, tools)
        })
        .catch(() => {
          // Discovery is best-effort; the shipped rings keep the armory usable without it.
        })
      return discoveryOnce
    },
    runVersionProbe: (program, args, timeoutMs) =>
      runProcess({ program, args, timeoutMs }).then((run) => ({
        code: run.code,
        stdout: run.stdout,
        stderr: run.stderr,
        ...(run.timedOut === true ? { timedOut: true } : {})
      }))
  }
}

const toToolView = (tool: ArmoryToolDescriptor): ArmoryToolView => ({
  id: tool.id,
  title: tool.title,
  category: tool.category,
  runtime: tool.runtime,
  target: tool.target,
  scopeClass: tool.scopeClass,
  status: tool.status
})

const firstLine = (output: string): string => output.split('\n')[0] ?? ''

const ipv4FromInt = (value: number): string =>
  [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join('.')

const scopeState = (deps: ArmoryHandlerDeps): ArmoryScopeState => {
  const scope = scopeFromEnv(deps.env)
  return {
    raw: deps.env.OSHIELD_ARMORY_SCOPE ?? '',
    targets: [...scope.exact],
    cidrs: scope.cidrs.map(({ network, prefix }) => `${ipv4FromInt(network)}/${prefix}`),
    exploitAuthorized: deps.env.OSHIELD_ARMORY_EXPLOIT_AUTHORIZED === '1',
    authorized: scope.exact.size > 0 || scope.cidrs.length > 0
  }
}

const healthReport = async (deps: ArmoryHandlerDeps): Promise<ArmoryHealthReport> => {
  const entries: ArmoryHealthEntry[] = []
  let healthy = 0
  let checkable = 0
  for (const tool of deps.listTools()) {
    if (tool.status !== 'ok') {
      entries.push({ toolId: tool.id, state: 'skipped', detail: `status: ${tool.status}` })
      continue
    }
    checkable += 1
    const argv = buildArgv(tool, [...tool.versionArgv])
    if (!argv.ok) {
      entries.push({ toolId: tool.id, state: 'denied', detail: argv.reason })
      continue
    }
    try {
      const run = await deps.runVersionProbe(
        argv.argv[0],
        argv.argv.slice(1),
        HEALTH_PROBE_TIMEOUT_MS
      )
      const ok = run.code === 0 || run.stdout.length > 0
      if (ok) {
        healthy += 1
      }
      entries.push({
        toolId: tool.id,
        state: ok ? 'ok' : 'unhealthy',
        detail: (firstLine(run.stdout) || firstLine(run.stderr)).slice(0, DETAIL_MAX_CHARS)
      })
    } catch (error) {
      entries.push({
        toolId: tool.id,
        state: 'spawn-failed',
        detail: (error instanceof Error ? error.message : String(error)).slice(0, DETAIL_MAX_CHARS)
      })
    }
  }
  return { entries, healthy, checkable }
}

const runTool = async (deps: ArmoryHandlerDeps, rawRequest: unknown): Promise<ArmoryRunOutcome> => {
  const request: ArmoryRunIpcRequest = ArmoryRunIpcRequestSchema.parse(rawRequest)
  const tool = deps.listTools().find((candidate) => candidate.id === request.toolId)
  if (tool === undefined) {
    return { ok: false, reason: `unknown or not-installed tool: ${request.toolId}` }
  }
  const result = await runArmoryTool(tool, {
    // Scope-checked targets are part of the spawned argv (CLI parity: args after `--`).
    args: [...request.args, ...request.targets],
    targets: request.targets,
    scope: scopeFromEnv(deps.env),
    exploitAuthorized: deps.env.OSHIELD_ARMORY_EXPLOIT_AUTHORIZED === '1'
  })
  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }
  return { ok: true, record: result.record, auditEvent: armoryRunAuditEvent(result.record) }
}

const setupReport = async (deps: ArmoryHandlerDeps): Promise<ArmorySetupState> => {
  const items: ArmorySetupItem[] = []
  const scope = scopeState(deps)
  items.push({
    id: 'scope',
    ok: scope.authorized,
    detail: scope.authorized
      ? `scope: ${[...scope.targets, ...scope.cidrs].join(', ')}`
      : 'no authorized scope',
    hint: 'set OSHIELD_ARMORY_SCOPE (e.g. 192.168.1.0/24) and relaunch'
  })
  const nmap = deps.listTools().find((tool) => tool.id === 'nmap')
  items.push({
    id: 'nmap',
    ok: nmap?.status === 'ok',
    detail: nmap?.status === 'ok' ? `nmap found: ${nmap.target}` : 'nmap not discovered',
    hint: 'install nmap (nmap.org) or add it to PATH; the armory re-probes on next open'
  })
  const inventoryDir = deps.inventoryDir ?? ''
  items.push({
    id: 'inventory',
    ok: inventoryDir.length > 0 && existsSync(inventoryDir),
    detail: inventoryDir.length > 0 ? `inventory: ${inventoryDir}` : 'inventory dir unresolved',
    hint: 'opens automatically after the first Armory page load'
  })
  try {
    const wsl = await deps.runVersionProbe('wsl', ['--status'], 6_000)
    items.push({
      id: 'wsl',
      ok: wsl.code === 0,
      detail:
        wsl.code === 0
          ? 'WSL available (Ubuntu-backed tools usable)'
          : `WSL probe exit ${wsl.code}`,
      hint: 'wsl --install -d Ubuntu enables WSL-runtime tools'
    })
  } catch (error) {
    items.push({
      id: 'wsl',
      ok: false,
      detail: `WSL unavailable: ${(error instanceof Error ? error.message : String(error)).slice(0, DETAIL_MAX_CHARS)}`,
      hint: 'wsl --install -d Ubuntu enables WSL-runtime tools'
    })
  }
  try {
    const docker = await deps.runVersionProbe('docker', ['--version'], 6_000)
    items.push({
      id: 'docker',
      ok: docker.code === 0,
      detail:
        docker.code === 0
          ? `docker: ${firstLine(docker.stdout)}`
          : `docker probe exit ${docker.code}`,
      hint: 'start Docker Desktop to enable docker-runtime tools'
    })
  } catch (error) {
    items.push({
      id: 'docker',
      ok: false,
      detail: `docker unavailable: ${(error instanceof Error ? error.message : String(error)).slice(0, DETAIL_MAX_CHARS)}`,
      hint: 'start Docker Desktop to enable docker-runtime tools'
    })
  }
  return { items }
}

export function registerArmoryHandlers(deps: ArmoryHandlerDeps = defaultArmoryHandlerDeps()): void {
  const handleTrusted = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedUIRenderer(event.sender)) {
        throw new Error('Unauthorized armory IPC sender')
      }
      return listener(event, ...args)
    })
  }

  handleTrusted('armory:list', async () => {
    await deps.ensureDiscovered?.()
    return deps.listTools().map(toToolView)
  })
  handleTrusted('armory:scope', () => scopeState(deps))
  handleTrusted('armory:health', () => healthReport(deps))
  handleTrusted('armory:setup', () => setupReport(deps))
  handleTrusted('armory:run', (_event, rawRequest: unknown) => runTool(deps, rawRequest))
}
