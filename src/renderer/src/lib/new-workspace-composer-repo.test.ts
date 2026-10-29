import { describe, expect, it } from 'vitest'
import type { Repo } from '../../../shared/repo-types'
import {
  getComposerEligibleRepos,
  resolveComposerActiveRepoId
} from './new-workspace-composer-repo'

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `/repos/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 0,
    ...overrides
  }
}

describe('new-workspace-composer-repo', () => {
  describe('resolveComposerActiveRepoId', () => {
    const localShield = makeRepo('local-shield', { upstream: { owner: 'octopusshield', repo: 'shield' } })
    const runtimeShield = makeRepo('runtime-shield', {
      connectionId: 'runtime-ssh-shield-1',
      upstream: { owner: 'octopusshield', repo: 'shield' }
    })
    const otherProject = makeRepo('noqa', { upstream: { owner: 'octopusshield', repo: 'noqa' } })
    const repos = [otherProject, localShield, runtimeShield]
    const eligibleRepos = getComposerEligibleRepos(repos)

    it('maps an active runtime-owned SSH repo to its local same-project sibling', () => {
      expect(resolveComposerActiveRepoId(repos, eligibleRepos, 'runtime-shield')).toBe('local-shield')
    })

    it('keeps the runtime repo id when no same-project sibling is eligible', () => {
      const onlyRuntime = [runtimeShield]
      expect(
        resolveComposerActiveRepoId(
          onlyRuntime,
          getComposerEligibleRepos(onlyRuntime),
          'runtime-shield'
        )
      ).toBe('runtime-shield')
    })
  })
})
