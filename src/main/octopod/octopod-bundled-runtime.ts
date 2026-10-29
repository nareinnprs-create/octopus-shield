import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { constants } from 'node:os'
import { spawnProcess } from '@shield/process-host'
import { resolveOctopodInstallRoot } from './octopod-app-paths'
import { OCTOPOD_EXIT_CONFIGURATION } from './octopod-configuration-exit'
import {
  OCTOPOD_NODE_RUNTIME_MARKER_FILENAME,
  OCTOPOD_SERVER_TARGET_FILENAME,
  OCTOPOD_VERSION_FILENAME,
  octopodNodeRuntimeRelativePath
} from '../../shared/octopod-artifacts'
import { NODE_RUNTIME_PIN, nodeRuntimeAsset } from '../../shared/node-runtime-pin'

export class OctopodBundledRuntimeError extends Error {}
export const OCTOPOD_BUNDLED_LAUNCHER_ENV = 'OSHIELD_BUNDLED_LAUNCHER_CHANNEL'

/** Null for unpackaged entries; reject torn/foreign runtime references in packaged slots. */
export function resolveBundledOctopodRuntime(directory: string): string | null {
  const markerPath = join(directory, OCTOPOD_NODE_RUNTIME_MARKER_FILENAME)
  const targetPath = join(directory, OCTOPOD_SERVER_TARGET_FILENAME)
  const hasMarker = existsSync(markerPath)
  const hasTarget = existsSync(targetPath)
  if (!hasMarker && !hasTarget && !existsSync(join(directory, OCTOPOD_VERSION_FILENAME))) {
    return null
  }
  if (!hasTarget) {
    throw new OctopodBundledRuntimeError('The bundled Shield runtime target is missing')
  }
  if (!hasMarker) {
    throw new OctopodBundledRuntimeError('The bundled Shield runtime reference is missing')
  }
  const target = readFileSync(targetPath, 'utf8').trim()
  // Compat targets use the same Node version built for older glibc.
  const asset = nodeRuntimeAsset(target)
  if (!asset) {
    throw new OctopodBundledRuntimeError(`The bundled Shield runtime target is invalid: ${target}`)
  }
  const executableSha256 = readFileSync(markerPath, 'utf8').trim()
  // Validate the exact runtime pin: this marker becomes a path segment.
  if (executableSha256 !== asset.executableSha256) {
    throw new OctopodBundledRuntimeError(
      `The bundled Shield runtime reference does not name Node ${NODE_RUNTIME_PIN.version}`
    )
  }
  const runtime = join(directory, ...octopodNodeRuntimeRelativePath(target, executableSha256))
  if (!existsSync(runtime)) {
    throw new OctopodBundledRuntimeError('The bundled Shield runtime is missing')
  }
  return runtime
}

export function resolveBundledOctopodSlot(script = process.argv[1]): string {
  return resolveOctopodInstallRoot(script && realpathSync(script))
}

export function isRunningAsBundledOctopodRuntime(directory: string): boolean {
  const runtime = resolveBundledOctopodRuntime(directory)
  return runtime !== null && realpathSync(process.execPath) === realpathSync(runtime)
}

/** Reject substituted runtimes before opening profile state. */
export function assertOctopodServerRuntime(): void {
  if (Number(process.versions.node.split('.')[0]) < 18) {
    throw new OctopodBundledRuntimeError('The Shield server requires Node.js 18 or newer')
  }
  const directory = resolveBundledOctopodSlot()
  const runtime = resolveBundledOctopodRuntime(directory)
  if (runtime && !isRunningAsBundledOctopodRuntime(directory)) {
    throw new OctopodBundledRuntimeError('Start the Shield server with its bundled Node.js runtime')
  }
  if (runtime && process.versions.node !== NODE_RUNTIME_PIN.version) {
    throw new OctopodBundledRuntimeError(
      `The bundled Shield runtime must be Node ${NODE_RUNTIME_PIN.version}`
    )
  }
}

/** Hand old service commands to pinned Node before they can open profile state. */
export function handoffToBundledOctopod(): boolean {
  const script = process.argv[1]
  if (!script) {
    return false
  }
  const entry = realpathSync(script)
  const runtime = resolveBundledOctopodRuntime(dirname(entry))
  if (!runtime) {
    return false
  }
  if (realpathSync(process.execPath) === realpathSync(runtime)) {
    if (process.versions.node !== NODE_RUNTIME_PIN.version) {
      throw new OctopodBundledRuntimeError(
        `The bundled Shield runtime must be Node ${NODE_RUNTIME_PIN.version}`
      )
    }
    return false
  }
  const child = spawnProcess({
    program: runtime,
    args: [entry, ...process.argv.slice(2)],
    env: { ...process.env, [OCTOPOD_BUNDLED_LAUNCHER_ENV]: '1' },
    // Detach so Windows child jobs cannot kill the runtime before launcher-disconnect cleanup.
    detached: true,
    stdio: ['inherit', 'inherit', 'inherit', 'ipc']
  })
  // Node resets nohup; stop through INT/TERM or owner loss instead.
  const ignoreHangup = (): void => {}
  if (process.platform !== 'win32') {
    process.on('SIGHUP', ignoreHangup)
  }
  const forwards = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    const forward = (): void => {
      if (process.platform === 'win32') {
        // Detached Windows children have their own console; disconnect allows durable shutdown.
        if (child.connected) {
          child.disconnect()
        }
      } else {
        child.kill(signal)
      }
    }
    process.on(signal, forward)
    return { signal, forward }
  })
  const cleanup = (): void => {
    process.off('SIGHUP', ignoreHangup)
    for (const { signal, forward } of forwards) {
      process.off(signal, forward)
    }
  }
  child.once('error', (error) => {
    cleanup()
    console.error('octopod: could not start the bundled runtime:', error.message)
    process.exit(OCTOPOD_EXIT_CONFIGURATION)
  })
  child.once('exit', (code, signal) => {
    cleanup()
    if (signal && process.platform !== 'win32') {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? (signal ? 128 + constants.signals[signal] : 1))
  })
  return true
}
