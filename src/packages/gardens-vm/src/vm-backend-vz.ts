import {
  imageRefIsRemote,
  validateVmSpec,
  type VmBackend,
  type VmBackendDiagnostics,
  type VmHandle,
  type VmSpec,
  type VmState,
  type VmStopMode
} from './vm-backend'

/**
 * macOS Virtualization.framework backend. Deliberately unimplemented off macOS: driving VZ from
 * Node needs a compiled Swift helper (`VZVirtualMachineConfiguration`, macOS 11+ on Apple Silicon
 * or macOS 13+ on x86) bridged via a small JSON stdio protocol, which is out of scope for this
 * pass. The type below pins the interface so a future helper slots in without contract changes.
 */
export type VzBackend = VmBackend & VmBackendDiagnostics

const UNAVAILABLE_REASON = 'macOS host required: Virtualization.framework helper not implemented'

export const createVzBackend = (): VzBackend => {
  const refuse = (): never => {
    throw new Error(UNAVAILABLE_REASON)
  }
  return {
    id: 'vz',
    availability: async () => ({ available: false, reason: UNAVAILABLE_REASON }),
    available: async () => false,
    create: async (_spec: VmSpec) => refuse(),
    start: async (_handle: VmHandle) => refuse(),
    stop: async (_handle: VmHandle, _mode: VmStopMode) => refuse(),
    status: async (_handle: VmHandle) => 'stopped' as VmState,
    delete: async (_handle: VmHandle) => refuse()
  }
}

/** Kept exported so the eventual Swift-helper implementation reuses the exact validation path. */
export const vzValidateSpec = validateVmSpec

/** Remote image refs are refused uniformly across backends, including the future VZ one. */
export const vzRefusesRemoteImageRef = imageRefIsRemote
