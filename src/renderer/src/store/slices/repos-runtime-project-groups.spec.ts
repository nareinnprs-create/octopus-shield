import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../../../shared/repo-types'
import {
  createCompatibleRuntimeStatusResponseIfNeeded,
  type RuntimeEnvironmentCallRequest
} from '../../runtime/runtime-compatibility-test-fixture'
import { clearRuntimeCompatibilityCacheForTests } from '../../runtime/runtime-rpc-client'
import { createTestStore } from './store-test-helpers'
import { stubRuntimeEnvironmentBridge } from '../../runtime/runtime-environment-bridge-fixture'

export function registerReposRuntimeProjectGroupTests(): void {
  const runtimeEnvironmentCall = vi.fn()
  const runtimeEnvironmentTransportCall = vi.fn()

  describe('repo slice runtime project groups', () => {
    beforeEach(() => {
      clearRuntimeCompatibilityCacheForTests()
      runtimeEnvironmentCall.mockReset()
      runtimeEnvironmentTransportCall.mockReset()
      runtimeEnvironmentTransportCall.mockImplementation((args: RuntimeEnvironmentCallRequest) => {
        return createCompatibleRuntimeStatusResponseIfNeeded(args) ?? runtimeEnvironmentCall(args)
      })
      stubRuntimeEnvironmentBridge({ call: runtimeEnvironmentTransportCall })
    })

    it('keeps runtime copies of a grouped canonical project in the same project group', async () => {
      const gitRemoteIdentity = {
        canonicalKey: 'github.com/octopusshield/octopus-shield',
        remoteName: 'origin',
        remoteUrl: 'https://github.com/octopusshield/octopus-shield.git'
      }
      const localShield: Repo = {
        id: 'local-shield',
        path: '/Users/alice/stably/shield',
        displayName: 'shield',
        badgeColor: '#000',
        addedAt: 1,
        executionHostId: 'local',
        gitRemoteIdentity,
        projectGroupId: 'group-shield'
      }
      const runtimeShield: Repo = {
        id: 'runtime-shield',
        path: '/vercel/sandbox/shield',
        displayName: 'shield',
        badgeColor: '#111',
        addedAt: 2,
        gitRemoteIdentity
      }
      runtimeEnvironmentCall.mockResolvedValue({
        id: 'rpc-runtime-shield',
        ok: true,
        result: { repos: [runtimeShield] },
        _meta: { runtimeId: 'runtime-remote' }
      })
      const store = createTestStore()
      store.setState({
        settings: { activeRuntimeEnvironmentId: 'env-1' } as never,
        repos: [localShield]
      })

      await store.getState().fetchRepos(catalogOwner(store))

      expect(store.getState().repos).toEqual([
        localShield,
        {
          ...runtimeShield,
          executionHostId: 'runtime:env-1',
          projectGroupId: 'group-shield'
        }
      ])
    })
  })

  // The catalog these tests read is the one the focused host would have shown.
  function catalogOwner(store: {
    getState: () => { settings: { activeRuntimeEnvironmentId?: string | null } | null }
  }): { runtimeEnvironmentId: string | null } {
    return { runtimeEnvironmentId: store.getState().settings?.activeRuntimeEnvironmentId ?? null }
  }
}
