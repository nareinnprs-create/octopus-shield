import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShieldRuntimeService, addWorktree } from '../shield-runtime-test-mocks.spec'
import { store } from '../shield-runtime-test-fixtures.spec'

const RUNTIME_REPO_PATH = '/remote/repo'

function makeRuntimeHostedStore(extraRepoFields: Record<string, unknown> = {}) {
  const repo = {
    ...store.getRepos()[0]!,
    path: RUNTIME_REPO_PATH,
    executionHostId: 'runtime:env-1',
    ...extraRepoFields
  }
  return {
    ...store,
    getRepos: () => [repo],
    getRepo: (id: string) => (id === repo.id ? repo : undefined)
  }
}

describe('ShieldRuntimeService worktree create execution host', () => {
  beforeEach(() => {
    vi.mocked(addWorktree).mockClear()
  })

  it('refuses to create for a runtime-hosted repo with no nested SSH target', async () => {
    const runtime = new ShieldRuntimeService(makeRuntimeHostedStore() as never)

    await expect(
      runtime.createManagedWorktree({ repoSelector: 'id:repo-1', name: 'wt' })
    ).rejects.toThrow('not dispatched by this process')

    expect(addWorktree).not.toHaveBeenCalled()
  })

  it('refuses a runtime-hosted repo that names a nested SSH target', async () => {
    // `target-a` names a target inside env-1, so creating through it here would put the checkout
    // on the wrong host.
    const runtime = new ShieldRuntimeService(
      makeRuntimeHostedStore({ connectionId: 'target-a' }) as never
    )

    await expect(
      runtime.createManagedWorktree({ repoSelector: 'id:repo-1', name: 'wt' })
    ).rejects.toThrow('not dispatched by this process')

    expect(addWorktree).not.toHaveBeenCalled()
  })
})
