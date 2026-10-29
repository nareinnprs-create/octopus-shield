import { describe, expect, it } from 'vitest'
import {
  getLegacyManagedOctopodOwnerEnvironmentId,
  getManagedOctopodFenceEnvironmentId,
  isEphemeralRuntimeSshOwner,
  managedOctopodServerName
} from './managed-octopod-ssh-owner'

describe('managed octopod SSH fence', () => {
  it('reads the fence from octopodFence, never from owner', () => {
    expect(getManagedOctopodFenceEnvironmentId({ octopodFence: { environmentId: 'env-1' } })).toBe(
      'env-1'
    )
    const legacyOnly = {
      octopodFence: undefined,
      owner: { type: 'on-demand-runtime' as const, runtimeId: 'managed-octopod:old' }
    }
    expect(getManagedOctopodFenceEnvironmentId({ ...legacyOnly })).toBeNull()
    expect(
      getManagedOctopodFenceEnvironmentId({ ...legacyOnly, octopodFence: { environmentId: 'env-2' } })
    ).toBe('env-2')
    expect(getManagedOctopodFenceEnvironmentId(undefined)).toBeNull()
  })

  it('recognises the legacy owner fence only so loading can migrate it', () => {
    const legacy = { type: 'on-demand-runtime' as const, runtimeId: 'managed-octopod:env-1' }
    expect(getLegacyManagedOctopodOwnerEnvironmentId(legacy)).toBe('env-1')
    expect(isEphemeralRuntimeSshOwner(legacy)).toBe(false)
  })

  it('keeps ordinary on-demand runtime targets ephemeral', () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-1' }
    expect(getLegacyManagedOctopodOwnerEnvironmentId(owner)).toBeNull()
    expect(isEphemeralRuntimeSshOwner(owner)).toBe(true)
  })

  it("names a recipe VM's server after its runtime, so two VMs of one recipe never collide", () => {
    const owner = { type: 'on-demand-runtime' as const, runtimeId: 'runtime-0123456789abcdef' }
    expect(managedOctopodServerName({ label: 'Docker root', owner })).toBe('Docker root VM 89abcdef')
    expect(
      managedOctopodServerName({
        label: 'Docker root',
        owner: { ...owner, runtimeId: 'runtime-fedcba9876543210' }
      })
    ).toBe('Docker root VM 76543210')
    expect(managedOctopodServerName({ label: 'Builder' })).toBe('Builder')
  })
})
