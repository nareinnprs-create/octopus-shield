import { afterEach, describe, expect, it } from 'vitest'
import {
  clearManagedOctopodUpdateDeferral,
  currentManagedOctopodUpdateDeferral,
  recordManagedOctopodUpdateDeferral
} from './octopod-managed-update-deferrals'

function defer(candidateVersion: string): void {
  recordManagedOctopodUpdateDeferral('env-1', {
    outcome: 'deferred',
    candidateVersion,
    code: 'octopod_activation_fence_busy',
    reason: 'Another update holds this host.',
    forceable: false
  })
}

afterEach(() => clearManagedOctopodUpdateDeferral('env-1'))

describe('a recorded update deferral', () => {
  it('is dropped once another desktop activated its candidate', () => {
    defer('0.1.0+9150d77ce015')
    expect(currentManagedOctopodUpdateDeferral('env-1', '0.1.0+9150d77ce015')).toBeNull()
    expect(currentManagedOctopodUpdateDeferral('env-1', '0.1.0+fb47a73e01d4')).toBeNull()
  })

  it('is dropped once the host runs a newer release', () => {
    defer('0.1.0+9150d77ce015')
    expect(currentManagedOctopodUpdateDeferral('env-1', '0.2.0+aaaaaaaaaaaa')).toBeNull()
  })

  it('stays while the host still runs an older or different build', () => {
    defer('0.1.0+9150d77ce015')
    expect(currentManagedOctopodUpdateDeferral('env-1', '0.1.0+fb47a73e01d4')).toMatchObject({
      candidateVersion: '0.1.0+9150d77ce015'
    })
    expect(currentManagedOctopodUpdateDeferral('env-1', null)).not.toBeNull()
  })
})
