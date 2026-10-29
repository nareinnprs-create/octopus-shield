import { runProcess as runProcessHost } from '@shield/process-host'
import { createHyperVBackend } from './vm-backend-hyperv'
import { createQemuBackend } from './vm-backend-qemu'
import { createVzBackend } from './vm-backend-vz'
import type {
  RunProcessLike,
  StartDetachedLike,
  VmBackend,
  VmBackendDiagnostics,
  VmBackendId
} from './vm-backend'

const defaultRunProcess: RunProcessLike = (spec, capture) => runProcessHost(spec, capture)

/** Default probe order: qemu → hyperv → vz. First `available()` wins at resolve time. */
export const createDefaultGardensBackends = (options: {
  dir: string
  env: Readonly<Record<string, string | undefined>>
  runProcess?: RunProcessLike
  startDetached?: StartDetachedLike
}): (VmBackend & Partial<VmBackendDiagnostics>)[] => [
  createQemuBackend({
    dir: options.dir,
    runProcess: options.runProcess ?? defaultRunProcess,
    startDetached: options.startDetached
  }),
  createHyperVBackend({ dir: options.dir, runProcess: options.runProcess, env: options.env }),
  createVzBackend()
]

/**
 * Availability probing never throws: a crashed probe (e.g. spawn ENOENT for a missing
 * binary) becomes an honest unavailable verdict instead of escaping lifecycle ops.
 */
export const probeAvailability = async (
  backend: VmBackend & Partial<VmBackendDiagnostics>
): Promise<{ available: boolean; reason: string }> => {
  try {
    return backend.availability !== undefined
      ? await backend.availability()
      : { available: await backend.available(), reason: '' }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error)
    }
  }
}

export type BackendVerdict = { id: VmBackendId; available: boolean; reason: string }

export type BackendSelector = {
  /** Detailed verdict for every configured backend, for the CLI status view. */
  matrix(): Promise<BackendVerdict[]>
  resolve(): Promise<{ ok: true; backend: VmBackend } | { ok: false; reason: string }>
}

/** Verdicts are cached for the selector lifetime; first available backend in order wins. */
export const createBackendSelector = (
  backends: readonly (VmBackend & Partial<VmBackendDiagnostics>)[]
): BackendSelector => {
  const cache = new Map<VmBackendId, { available: boolean; reason: string }>()
  return {
    matrix: async () => {
      const matrix: BackendVerdict[] = []
      for (const backend of backends) {
        const detailed = cache.get(backend.id) ?? (await probeAvailability(backend))
        cache.set(backend.id, detailed)
        matrix.push({ id: backend.id, ...detailed })
      }
      return matrix
    },
    resolve: async () => {
      const unavailable: string[] = []
      for (const backend of backends) {
        const cached = cache.get(backend.id)
        if (cached !== undefined && !cached.available) {
          unavailable.push(`${backend.id}: ${cached.reason}`)
          continue
        }
        const detailed = await probeAvailability(backend)
        cache.set(backend.id, detailed)
        if (detailed.available) {
          return { ok: true, backend }
        }
        unavailable.push(`${backend.id}: ${detailed.reason || 'not available'}`)
      }
      return { ok: false, reason: `no gardens VM backend available — ${unavailable.join('; ')}` }
    }
  }
}
