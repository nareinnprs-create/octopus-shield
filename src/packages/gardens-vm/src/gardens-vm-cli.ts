import {
  GARDENS_SCOPE_ENV,
  GardensVmManager,
  type GardensVmCreateRequest,
  type GardensVmOpResult
} from './gardens-vm'
import type { VmInspectInfo } from './vm-backend'
import type { VmImageId } from './vm-images'

export type GardensVmCliOptions = {
  argv: readonly string[]
  env: Readonly<Record<string, string | undefined>>
  manager?: GardensVmManager
  out?: (line: string) => void
  err?: (line: string) => void
  /** Injected only by tests; production passes globalThis.fetch explicitly. */
  fetchLike?: (
    url: string,
    init?: { method?: string }
  ) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>
}

type ParsedCommand = {
  command: string
  positional: string[]
  flags: Map<string, string | true>
}

export const parseGardensVmCommand = (argv: readonly string[]): ParsedCommand => {
  const flags = new Map<string, string | true>()
  const positional: string[] = []
  let command = ''
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const body = token.slice(2)
      const equals = body.indexOf('=')
      if (equals !== -1) {
        flags.set(body.slice(0, equals), body.slice(equals + 1))
      } else {
        const next = argv[index + 1]
        if (next !== undefined && !next.startsWith('--')) {
          flags.set(body, next)
          index += 1
        } else {
          flags.set(body, true)
        }
      }
      continue
    }
    if (command.length === 0) {
      command = token
    } else {
      positional.push(token)
    }
  }
  return { command, positional, flags }
}

const printResult = (result: GardensVmOpResult, out: (line: string) => void): void => {
  if (result.record !== undefined && result.audit !== undefined) {
    out(`audit ${JSON.stringify(result.audit)}`)
    out(
      `gardens-vm: ${result.record.operation} ${result.record.vmName} ok=${String(result.record.ok)} in ${String(result.record.durationMs)}ms`
    )
  }
}

const USAGE =
  'usage: gardens-vm status [<name>] | list | create <name> [--image <id>|--image-ref <path>] [--memory <mb>] [--disk <gb>] [--vcpus <n>] [--no-nat] [--ssh] | start <name> | stop <name> [--force] | delete <name> | snapshot <name> <snapshot-id> | list-snapshots <name> | rollback <name> <snapshot-id> | image-download <id>'

/** One line per fact; absent facts are omitted rather than guessed. */
export const formatVmInspection = (info: VmInspectInfo): string[] => {
  const lines = [
    `state     ${info.state}`,
    `pid       ${
      info.pid !== undefined ? `${String(info.pid)} (${info.pidAlive ? 'alive' : 'dead'})` : 'none'
    }`
  ]
  if (info.uptimeMs !== undefined) {
    lines.push(`uptime    ${String(Math.floor(info.uptimeMs / 1000))}s`)
  }
  if (info.imageRef !== undefined) {
    lines.push(`image     ${info.imageRef}`)
  }
  if (info.diskPath !== undefined) {
    const host =
      info.diskBytesOnHost !== undefined ? `, host ${String(info.diskBytesOnHost)} bytes` : ''
    lines.push(`disk      ${info.diskPath} (virtual ${String(info.diskGb ?? 0)} GiB${host})`)
  }
  if (info.memoryMb !== undefined || info.vcpus !== undefined) {
    lines.push(
      `resources ${String(info.memoryMb ?? '?')} MB memory, ${String(info.vcpus ?? '?')} vcpus`
    )
  }
  const ports = [
    info.sshHostPort !== undefined ? `ssh 127.0.0.1:${String(info.sshHostPort)}` : undefined,
    info.qmpPort !== undefined ? `qmp 127.0.0.1:${String(info.qmpPort)}` : undefined
  ].filter((entry) => entry !== undefined)
  lines.push(`ports     ${ports.length > 0 ? ports.join(', ') : 'none'}`)
  if (info.snapshotListError !== undefined) {
    lines.push(`snapshots unavailable: ${info.snapshotListError}`)
  } else {
    lines.push(
      `snapshots ${info.snapshots.length > 0 ? info.snapshots.map((snap) => snap.name).join(', ') : '(none)'}`
    )
  }
  return lines
}

export async function runGardensVmCli(options: GardensVmCliOptions): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`))
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`))
  const manager = options.manager ?? new GardensVmManager({ env: options.env })
  const parsed = parseGardensVmCommand(options.argv)

  if (parsed.command === 'status') {
    const name = parsed.positional[0]
    if (name !== undefined) {
      const inspected = await manager.inspect(name)
      if (!inspected.ok) {
        err(`gardens-vm: DENIED — ${inspected.reason}`)
        return 3
      }
      for (const line of formatVmInspection(inspected.info)) {
        out(line)
      }
      return 0
    }
    const scopeRaw = options.env[GARDENS_SCOPE_ENV] ?? '(unset — deny-by-default)'
    out(`scope ${GARDENS_SCOPE_ENV}=${scopeRaw}`)
    for (const entry of await manager.backendMatrix()) {
      out(
        `${entry.available ? 'available  ' : 'UNAVAILABLE'} ${entry.id.padEnd(6)} ${entry.reason}`
      )
    }
    return 0
  }

  if (parsed.command === 'list') {
    const result = await manager.list()
    if (!result.ok) {
      err(`gardens-vm: DENIED — ${result.reason}`)
      return 3
    }
    for (const entry of result.entries ?? []) {
      out(`${entry.state.padEnd(10)} ${entry.name}`)
    }
    out(
      `${(result.entries ?? []).length} garden VMs in scope (${result.record?.backend ?? 'none'})`
    )
    return 0
  }

  if (parsed.command === 'create') {
    const name = parsed.positional[0]
    if (name === undefined) {
      err(USAGE)
      return 2
    }
    const request: GardensVmCreateRequest = {
      name,
      imageId: parsed.flags.get('image') as VmImageId | undefined,
      imageRef:
        typeof parsed.flags.get('image-ref') === 'string'
          ? (parsed.flags.get('image-ref') as string)
          : undefined,
      memoryMb: parsed.flags.has('memory') ? Number(parsed.flags.get('memory')) : undefined,
      diskGb: parsed.flags.has('disk') ? Number(parsed.flags.get('disk')) : undefined,
      vcpus: parsed.flags.has('vcpus') ? Number(parsed.flags.get('vcpus')) : undefined,
      natNetwork: parsed.flags.get('no-nat') !== true,
      ssh: parsed.flags.has('ssh')
    }
    const result = await manager.create(request)
    if (!result.ok) {
      err(`gardens-vm: DENIED — ${result.reason}`)
      return 3
    }
    printResult(result, out)
    if (request.ssh) {
      const port = result.handle?.sshHostPort
      out(
        port !== undefined
          ? `ssh hostfwd reserved: 127.0.0.1:${String(port)} -> guest :22 (bound at start; guest must run sshd — no provisioning is performed)`
          : 'ssh requested but the backend reserved no hostfwd port'
      )
    }
    return 0
  }

  if (parsed.command === 'snapshot' || parsed.command === 'rollback') {
    const [name, snapshotId] = parsed.positional
    if (name === undefined || snapshotId === undefined) {
      err(USAGE)
      return 2
    }
    const result =
      parsed.command === 'snapshot'
        ? await manager.snapshot(name, snapshotId)
        : await manager.rollback(name, snapshotId)
    if (!result.ok) {
      err(`gardens-vm: DENIED — ${result.reason}`)
      return 3
    }
    printResult(result, out)
    return 0
  }

  if (parsed.command === 'list-snapshots') {
    const name = parsed.positional[0]
    if (name === undefined) {
      err(USAGE)
      return 2
    }
    const result = await manager.listSnapshots(name)
    if (!result.ok) {
      err(`gardens-vm: DENIED — ${result.reason}`)
      return 3
    }
    for (const snapshot of result.snapshots) {
      out(
        `${snapshot.id.padEnd(4)} ${snapshot.name.padEnd(20)} ${String(snapshot.vmStateSizeBytes).padStart(12)} B ${new Date(snapshot.dateEpochMs).toISOString()}`
      )
    }
    out(`${String(result.snapshots.length)} snapshot(s) on ${name}`)
    return 0
  }

  if (parsed.command === 'start' || parsed.command === 'stop' || parsed.command === 'delete') {
    const name = parsed.positional[0]
    if (name === undefined) {
      err(USAGE)
      return 2
    }
    const result =
      parsed.command === 'start'
        ? await manager.start(name)
        : parsed.command === 'stop'
          ? await manager.stop(name, parsed.flags.get('force') === true ? 'force' : 'acpi')
          : await manager.delete(name)
    if (!result.ok) {
      err(`gardens-vm: DENIED — ${result.reason}`)
      return 3
    }
    printResult(result, out)
    return 0
  }

  if (parsed.command === 'image-download') {
    const imageId = parsed.positional[0]
    if (imageId === undefined) {
      err(USAGE)
      return 2
    }
    const fetchLike =
      options.fetchLike ??
      ((url: string, init?: { method?: string }) => globalThis.fetch(url, init))
    const result = await manager.downloadImage(imageId as VmImageId, fetchLike)
    if (!result.ok) {
      err(`gardens-vm: DENIED — ${result.reason}`)
      return 3
    }
    printResult(result, out)
    return 0
  }

  err(USAGE)
  return 2
}

if (
  process.argv[1]?.endsWith('gardens-vm-cli.js') ||
  process.argv[1]?.endsWith('gardens-vm-cli.ts')
) {
  void runGardensVmCli({ argv: process.argv.slice(2), env: process.env }).then((code) => {
    process.exitCode = code
  })
}
