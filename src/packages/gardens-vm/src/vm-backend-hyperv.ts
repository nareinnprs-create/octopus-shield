import { runProcess as runProcessHost } from '@shield/process-host'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  imageRefIsRemote,
  validateVmSpec,
  type RunProcessLike,
  type VmBackend,
  type VmBackendDiagnostics,
  type VmHandle,
  type VmSpec,
  type VmState,
  type VmStopMode
} from './vm-backend'

export type HyperVBackendDeps = {
  dir: string
  runProcess?: RunProcessLike
  env?: Readonly<Record<string, string | undefined>>
  platform?: NodeJS.Platform
  powershellBin?: string
}

const psQuote = (value: string): string => `'${value}'`

export const hypervAvailabilityScript = [
  '$s = Get-Service vmcompute -ErrorAction SilentlyContinue',
  '$a = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
  "if ($s -and $s.Status -eq 'Running' -and $a) { 'GARDENS_HYPERV_AVAILABLE' } else { \"GARDENS_HYPERV_UNAVAILABLE service=$($s.Status) admin=$a\" }"
].join('; ')

export const buildHyperVNewVmScript = (
  spec: VmSpec,
  vhdPath: string,
  switchName?: string
): string => {
  const parts = [
    `New-VM -Name ${psQuote(spec.name)} -MemoryStartupBytes ${String(Math.round(spec.memoryMb * 1024 * 1024))} -NewVHDPath ${psQuote(vhdPath)} -NewVHDSizeBytes ${String(Math.round(spec.diskGb * 1024 * 1024 * 1024))} -Generation 1`
  ]
  if (spec.natNetwork && switchName) {
    parts.push(
      `Connect-VMNetworkAdapter -VMName ${psQuote(spec.name)} -SwitchName ${psQuote(switchName)}`
    )
  }
  if (spec.imageRef.toLowerCase().endsWith('.iso')) {
    parts.push(`Add-VMDvdDrive -VMName ${psQuote(spec.name)} -Path ${psQuote(spec.imageRef)}`)
  }
  return parts.join('; ')
}

export const buildHyperVStartScript = (name: string): string => `Start-VM -Name ${psQuote(name)}`

export const buildHyperVStopScript = (name: string, mode: VmStopMode): string =>
  mode === 'force'
    ? `Stop-VM -Name ${psQuote(name)} -TurnOff -Force`
    : `Stop-VM -Name ${psQuote(name)}`

export const buildHyperVStateScript = (name: string): string =>
  `(Get-VM -Name ${psQuote(name)}).State`

export const buildHyperVRemoveScript = (name: string, vhdPath: string): string =>
  [
    `Stop-VM -Name ${psQuote(name)} -TurnOff -Force -ErrorAction SilentlyContinue`,
    `Remove-VM -Name ${psQuote(name)} -Force`,
    `Remove-Item ${psQuote(vhdPath)} -Force -ErrorAction SilentlyContinue`
  ].join('; ')

export const buildHyperVCheckpointScript = (name: string, snapshotName: string): string =>
  `Checkpoint-VM -Name ${psQuote(name)} -SnapshotName ${psQuote(snapshotName)}`

export const buildHyperVListScript = (): string =>
  '(Get-VM | Select-Object -ExpandProperty Name) -join ","'

const mapHyperVState = (raw: string): VmState => {
  const state = raw.trim().toLowerCase()
  if (state === 'running') {
    return 'running'
  }
  if (state === 'off' || state === 'saved' || state === 'paused' || state === '') {
    return 'stopped'
  }
  return 'error'
}

export const hyperVVhdPath = (dir: string, name: string): string => join(dir, `${name}.vhdx`)

export type HyperVBackend = VmBackend & VmBackendDiagnostics

export const createHyperVBackend = (deps: HyperVBackendDeps): HyperVBackend => {
  const platform = deps.platform ?? process.platform
  const env = deps.env ?? process.env
  const runProcess: RunProcessLike = deps.runProcess ?? runProcessHost
  const powershellBin = deps.powershellBin ?? 'powershell.exe'

  const runScript = async (script: string): Promise<string> => {
    const run = await runProcess({
      program: powershellBin,
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      timeoutMs: 120_000
    })
    if (run.code !== 0) {
      throw new Error(`hyper-v command failed: ${run.stderr.trim() || `exit ${String(run.code)}`}`)
    }
    return run.stdout
  }

  const availability = async (): Promise<{ available: boolean; reason: string }> => {
    if (platform !== 'win32') {
      return { available: false, reason: 'Windows host required' }
    }
    const out = await runScript(hypervAvailabilityScript)
    if (out.includes('GARDENS_HYPERV_AVAILABLE')) {
      return { available: true, reason: 'vmcompute running with administrator elevation' }
    }
    return { available: false, reason: out.trim() || 'hyper-v unavailable' }
  }

  return {
    id: 'hyperv',
    availability,
    available: async () => (await availability()).available,
    create: async (spec: VmSpec) => {
      const valid = validateVmSpec(spec)
      if (!valid.ok) {
        throw new Error(valid.reason)
      }
      if (imageRefIsRemote(spec.imageRef)) {
        throw new Error(
          `remote imageRef refused; materialize via vm-images first: ${spec.imageRef}`
        )
      }
      if (!existsSync(spec.imageRef)) {
        throw new Error(`imageRef does not exist: ${spec.imageRef}`)
      }
      mkdirSync(deps.dir, { recursive: true })
      const vhdPath = hyperVVhdPath(deps.dir, spec.name)
      if (existsSync(vhdPath)) {
        throw new Error(`garden VM ${spec.name} already exists on the hyper-v backend`)
      }
      await runScript(buildHyperVNewVmScript(spec, vhdPath, env.OSHIELD_HYPERV_SWITCH))
      return {
        id: spec.name,
        backend: 'hyperv',
        state: 'created',
        name: spec.name,
        diskPath: vhdPath
      }
    },
    start: async (handle: VmHandle) => {
      await runScript(buildHyperVStartScript(handle.id))
      return { ...handle, state: 'running' }
    },
    stop: async (handle: VmHandle, mode: VmStopMode) => {
      await runScript(buildHyperVStopScript(handle.id, mode))
      return { ...handle, state: 'stopped' }
    },
    status: async (handle: VmHandle) => {
      const out = await runScript(buildHyperVStateScript(handle.id))
      if (out.trim().length === 0) {
        throw new Error(`hyper-v VM ${handle.id} not found`)
      }
      return mapHyperVState(out)
    },
    listNames: async () => {
      const out = (await runScript(buildHyperVListScript())).trim()
      return out.length === 0 ? [] : out.split(',')
    },
    delete: async (handle: VmHandle) => {
      await runScript(buildHyperVRemoveScript(handle.id, hyperVVhdPath(deps.dir, handle.id)))
    }
  }
}
