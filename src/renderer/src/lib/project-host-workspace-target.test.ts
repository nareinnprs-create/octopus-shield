import { describe, expect, it } from 'vitest'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { Project, ProjectHostSetup } from '../../../shared/project-types'
import type { Repo } from '../../../shared/repo-types'
import {
  resolveWorkspaceCreationRepoId,
  resolveWorkspaceCreationTarget
} from './project-host-workspace-target'

function makeRepo(id: string, overrides: Partial<Repo> = {}): Repo {
  return {
    id,
    path: `/repos/${id}`,
    displayName: id,
    badgeColor: '#000000',
    addedAt: 1,
    ...overrides
  }
}

function makeProject(
  id: string,
  sourceRepoIds: string[],
  overrides: Partial<Project> = {}
): Project {
  return {
    id,
    displayName: id,
    badgeColor: '#000000',
    sourceRepoIds,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function makeSetup(
  id: string,
  projectId: string,
  hostId: ExecutionHostId,
  repoId: string,
  overrides: Partial<ProjectHostSetup> = {}
): ProjectHostSetup {
  return {
    id,
    projectId,
    hostId,
    repoId,
    path: `/repos/${repoId}`,
    displayName: repoId,
    setupState: 'ready',
    setupMethod: 'legacy-repo',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

describe('project-host workspace target resolution', () => {
  it('falls back to a local setup for a local-only repo', () => {
    const repo = makeRepo('shield')

    const resolution = resolveWorkspaceCreationTarget({ eligibleRepos: [repo] })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        projectId: 'repo:shield',
        hostId: 'local',
        projectHostSetupId: 'shield',
        repoId: 'shield'
      }
    })
  })

  it('chooses the focused host setup when one project exists on multiple hosts', () => {
    const repos = [makeRepo('shield-local'), makeRepo('shield-ssh', { connectionId: 'openclaw-2' })]
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield-local', 'shield-ssh'])]
    const projectHostSetups = [
      makeSetup('shield-local', 'github:octopusshield/octopus-shield', 'local', 'shield-local'),
      makeSetup('shield-ssh', 'github:octopusshield/octopus-shield', 'ssh:openclaw-2', 'shield-ssh')
    ]

    expect(
      resolveWorkspaceCreationRepoId({
        eligibleRepos: repos,
        projects,
        projectHostSetups,
        projectId: 'github:octopusshield/octopus-shield',
        focusedHostScope: 'ssh:openclaw-2'
      })
    ).toBe('shield-ssh')
  })

  it('matches duplicate repo ids to the setup execution host', () => {
    const localRepo = makeRepo('shield', { path: '/local/shield' })
    const sshRepo = makeRepo('shield', {
      path: '/remote/shield',
      connectionId: 'builder'
    })
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:octopusshield/octopus-shield', 'local', 'shield'),
      makeSetup('ssh-setup', 'github:octopusshield/octopus-shield', 'ssh:builder', 'shield')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: [localRepo, sshRepo],
      projects,
      projectHostSetups,
      projectHostSetupId: 'ssh-setup'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'ssh:builder',
        repo: { path: '/remote/shield', connectionId: 'builder' }
      }
    })
  })

  it('keeps a focused duplicate repo id on its selected host', () => {
    const localRepo = makeRepo('shield', { path: '/local/shield' })
    const sshRepo = makeRepo('shield', { path: '/remote/shield', connectionId: 'builder' })
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:octopusshield/octopus-shield', 'local', 'shield'),
      makeSetup('ssh-setup', 'github:octopusshield/octopus-shield', 'ssh:builder', 'shield')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, sshRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'shield',
        focusedHostScope: 'ssh:builder'
      })
    ).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'ssh:builder',
        projectHostSetupId: 'ssh-setup',
        repo: { path: '/remote/shield', connectionId: 'builder' }
      }
    })
  })

  it('resolves duplicate repo ids to a ready setup when no host is focused', () => {
    const localRepo = makeRepo('shield', { path: '/local/shield' })
    const sshRepo = makeRepo('shield', { path: '/remote/shield', connectionId: 'builder' })
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield'])]
    const projectHostSetups = [
      makeSetup('local-setup', 'github:octopusshield/octopus-shield', 'local', 'shield'),
      makeSetup('ssh-setup', 'github:octopusshield/octopus-shield', 'ssh:builder', 'shield')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, sshRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'shield',
        focusedHostScope: 'all',
        actionableHostIds: new Set(['local', 'ssh:builder'])
      })
    ).toMatchObject({
      status: 'ready',
      target: {
        hostId: 'local',
        projectHostSetupId: 'local-setup',
        repoId: 'shield',
        repo: { path: '/local/shield' }
      }
    })
  })

  it('resolves an explicit project and host to the matching setup', () => {
    const repos = [
      makeRepo('shield-local'),
      makeRepo('shield-runtime', { executionHostId: 'runtime:gpu-1' })
    ]
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield-local', 'shield-runtime'])]
    const projectHostSetups = [
      makeSetup('shield-local', 'github:octopusshield/octopus-shield', 'local', 'shield-local'),
      makeSetup('shield-runtime', 'github:octopusshield/octopus-shield', 'runtime:gpu-1', 'shield-runtime')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: repos,
      projects,
      projectHostSetups,
      projectId: 'github:octopusshield/octopus-shield',
      hostId: 'runtime:gpu-1'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: {
        projectId: 'github:octopusshield/octopus-shield',
        hostId: 'runtime:gpu-1',
        projectHostSetupId: 'shield-runtime',
        repoId: 'shield-runtime'
      }
    })
  })

  it('canonicalizes a stale same-host setup id to the setup the picker shows', () => {
    // Legacy drafts can name hidden duplicate setups; creation must use the canonical picker row/path.
    const repos = [makeRepo('shield-main'), makeRepo('shield-worktree')]
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield-main', 'shield-worktree'])]
    const projectHostSetups = [
      makeSetup('shield-main', 'github:octopusshield/octopus-shield', 'local', 'shield-main'),
      makeSetup('shield-worktree', 'github:octopusshield/octopus-shield', 'local', 'shield-worktree')
    ]

    const resolution = resolveWorkspaceCreationTarget({
      eligibleRepos: repos,
      projects,
      projectHostSetups,
      projectHostSetupId: 'shield-worktree'
    })

    expect(resolution).toMatchObject({
      status: 'ready',
      target: { projectHostSetupId: 'shield-main', repoId: 'shield-main', hostId: 'local' }
    })
  })

  it('keeps an explicit setup id that is the only one on its host', () => {
    const repos = [makeRepo('shield-local'), makeRepo('shield-ssh', { connectionId: 'builder' })]
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield-local', 'shield-ssh'])]
    const projectHostSetups = [
      makeSetup('shield-local', 'github:octopusshield/octopus-shield', 'local', 'shield-local'),
      makeSetup('shield-ssh', 'github:octopusshield/octopus-shield', 'ssh:builder', 'shield-ssh')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: repos,
        projects,
        projectHostSetups,
        projectHostSetupId: 'shield-ssh'
      })
    ).toMatchObject({
      status: 'ready',
      target: { projectHostSetupId: 'shield-ssh', repoId: 'shield-ssh', hostId: 'ssh:builder' }
    })
  })

  it('does not merge same-name repos without shared project identity', () => {
    const repos = [
      makeRepo('personal-shield', { displayName: 'shield' }),
      makeRepo('work-shield', { displayName: 'shield', connectionId: 'work-linux' })
    ]

    expect(
      resolveWorkspaceCreationRepoId({
        eligibleRepos: repos,
        projectId: 'repo:personal-shield',
        focusedHostScope: 'ssh:work-linux'
      })
    ).toBe('personal-shield')
  })

  it('reports unavailable when the project is not set up on the selected host', () => {
    const repo = makeRepo('shield')
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield'])]
    const projectHostSetups = [makeSetup('shield', 'github:octopusshield/octopus-shield', 'local', 'shield')]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [repo],
        projects,
        projectHostSetups,
        projectId: 'github:octopusshield/octopus-shield',
        hostId: 'ssh:openclaw-2'
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'project-not-set-up-on-host'
    })
  })

  it('does not fall back to another host when only a host is selected', () => {
    const localRepo = makeRepo('shield-local')
    const remoteRepo = makeRepo('shield-ssh', { connectionId: 'builder' })
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield-local', 'shield-ssh'])]
    const projectHostSetups = [
      makeSetup('shield-local', 'github:octopusshield/octopus-shield', 'local', 'shield-local')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [localRepo, remoteRepo],
        projects,
        projectHostSetups,
        draftRepoId: 'shield-local',
        hostId: 'ssh:builder',
        actionableHostIds: new Set(['local', 'ssh:builder'])
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'project-not-set-up-on-host'
    })
  })

  it('reports setup-not-ready when the selected host has pending setup metadata', () => {
    const repo = makeRepo('shield')
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield'])]
    const projectHostSetups = [
      makeSetup('shield', 'github:octopusshield/octopus-shield', 'local', 'shield'),
      makeSetup('gpu-pending', 'github:octopusshield/octopus-shield', 'runtime:gpu', '', {
        path: '',
        setupState: 'setting-up',
        setupMethod: 'provisioned'
      })
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [repo],
        projects,
        projectHostSetups,
        projectId: 'github:octopusshield/octopus-shield',
        hostId: 'runtime:gpu'
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'setup-not-ready'
    })
  })

  it('reports unavailable when an explicit setup is not ready', () => {
    const repo = makeRepo('shield')
    const projects = [makeProject('github:octopusshield/octopus-shield', ['shield'])]
    const projectHostSetups = [
      makeSetup('shield', 'github:octopusshield/octopus-shield', 'local', 'shield', { setupState: 'setting-up' })
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [repo],
        projects,
        projectHostSetups,
        projectHostSetupId: 'shield'
      })
    ).toEqual({
      status: 'unavailable',
      reason: 'setup-not-ready'
    })
  })

  it('does not resolve workspace creation through a removed host', () => {
    const remoteRepo = makeRepo('remote-repo', { connectionId: 'removed' })
    const projects = [makeProject('repo:remote', ['remote-repo'])]
    const projectHostSetups = [
      makeSetup('removed-setup', 'repo:remote', 'ssh:removed', 'remote-repo')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [remoteRepo],
        projects,
        projectHostSetups,
        draftRepoId: remoteRepo.id,
        projectHostSetupId: 'removed-setup',
        actionableHostIds: new Set(['local'])
      })
    ).toEqual({ status: 'unavailable', reason: 'setup-not-found' })
  })

  it('does not silently switch an explicit setup id to an actionable sibling host', () => {
    const remoteRepo = makeRepo('remote-repo', { connectionId: 'removed' })
    const localRepo = makeRepo('local-repo')
    const projects = [makeProject('repo:shield', ['remote-repo', 'local-repo'])]
    const projectHostSetups = [
      makeSetup('removed-setup', 'repo:shield', 'ssh:removed', 'remote-repo'),
      makeSetup('local-setup', 'repo:shield', 'local', 'local-repo')
    ]

    expect(
      resolveWorkspaceCreationTarget({
        eligibleRepos: [remoteRepo, localRepo],
        projects,
        projectHostSetups,
        draftRepoId: remoteRepo.id,
        projectHostSetupId: 'removed-setup',
        actionableHostIds: new Set(['local'])
      })
    ).toEqual({ status: 'unavailable', reason: 'setup-not-found' })
  })

  // Project selection treats the current host as preference; a project available only elsewhere must resolve there instead of silently returning empty.
  describe('cross-host project selection', () => {
    const repos = [makeRepo('local-repo'), makeRepo('remote-repo', { connectionId: 'remote-1' })]
    const projects = [
      makeProject('repo:local-repo', ['local-repo']),
      makeProject('repo:remote-repo', ['remote-repo'])
    ]
    const projectHostSetups = [
      makeSetup('local-repo', 'repo:local-repo', 'local', 'local-repo'),
      makeSetup('remote-repo', 'repo:remote-repo', 'ssh:remote-1', 'remote-repo')
    ]

    it('resolves a remote-only project while the current host is local', () => {
      expect(
        resolveWorkspaceCreationRepoId({
          eligibleRepos: repos,
          projects,
          projectHostSetups,
          projectId: 'repo:remote-repo',
          focusedHostScope: 'local'
        })
      ).toBe('remote-repo')
    })

    it('resolves a local-only project while the current host is remote', () => {
      expect(
        resolveWorkspaceCreationRepoId({
          eligibleRepos: repos,
          projects,
          projectHostSetups,
          projectId: 'repo:local-repo',
          focusedHostScope: 'ssh:remote-1'
        })
      ).toBe('local-repo')
    })

    it('still prefers the current host when the project is set up on it', () => {
      const multiHostProjects = [makeProject('repo:multi', ['multi-local', 'multi-remote'])]
      const multiHostSetups = [
        makeSetup('multi-local', 'repo:multi', 'local', 'multi-local'),
        makeSetup('multi-remote', 'repo:multi', 'ssh:remote-1', 'multi-remote')
      ]

      expect(
        resolveWorkspaceCreationRepoId({
          eligibleRepos: [
            makeRepo('multi-local'),
            makeRepo('multi-remote', { connectionId: 'remote-1' })
          ],
          projects: multiHostProjects,
          projectHostSetups: multiHostSetups,
          projectId: 'repo:multi',
          focusedHostScope: 'local'
        })
      ).toBe('multi-local')
    })

    it('still reports unavailable for an explicit project+host with no ready setup', () => {
      // Explicit Run on host selection retains strict project+host matching; only project-dropdown calls use preference.
      expect(
        resolveWorkspaceCreationTarget({
          eligibleRepos: repos,
          projects,
          projectHostSetups,
          projectId: 'repo:remote-repo',
          hostId: 'local'
        })
      ).toEqual({
        status: 'unavailable',
        reason: 'project-not-set-up-on-host'
      })
    })
  })
})
