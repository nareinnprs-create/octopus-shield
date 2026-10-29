// Host answers both the desktop sidebar's and the phone's Project grouping tests run on.
import type { MobileProjectSectionCatalog } from './mobile-project-sections-contract'
import type { ExecutionHostId } from './execution-host'
import {
  projectHostSetupProjectionFromRepos,
  type ProjectHostSetupProjection
} from './project-host-setup-projection'
import type { Repo } from './repo-types'
import type { RuntimeClientTarget } from './runtime-client-target'

const shieldRemote = {
  canonicalKey: 'github.com/octopusshield/octopus-shield',
  remoteName: 'origin',
  remoteUrl: 'git@github.com:octopusshield/octopus-shield.git'
}

function hostRepo(id: string, path: string, displayName = 'shield'): Repo {
  return {
    id,
    path,
    displayName,
    badgeColor: '#737373',
    addedAt: 1,
    ...(displayName === 'shield' ? { gitRemoteIdentity: shieldRemote } : {})
  }
}

export type ParityHostAnswer = {
  target: RuntimeClientTarget
  hostId: ExecutionHostId
  /** In the host's own repo.list order. */
  repos: Repo[]
  /** The host's project.list/projectHostSetup.list rows; null for a host that predates them. */
  lists: ProjectHostSetupProjection | null
}

const localRepos = [
  hostRepo('local-stably', '/Users/jinwoo/stably/shield'),
  hostRepo('local-assets', '/Users/jinwoo/design-assets', 'design-assets'),
  hostRepo('local-workspace', '/Users/jinwoo/shield/workspaces/shield/shield')
]
const windowsRepo = hostRepo('win-shield', 'C:/Users/jinwo/shield/shield')

// Several local checkouts plus copies of the same project on two servers.
export const PROJECT_SECTION_PARITY_HOSTS: readonly ParityHostAnswer[] = [
  {
    target: { kind: 'local' },
    hostId: 'local',
    repos: localRepos,
    lists: projectHostSetupProjectionFromRepos(localRepos)
  },
  {
    target: { kind: 'environment', environmentId: 'windows2' },
    hostId: 'runtime:windows2',
    repos: [windowsRepo],
    // A server's own catalog rows: its project name and an imported setup on its local host.
    lists: {
      projects: [
        {
          id: 'github:octopusshield/octopus-shield',
          displayName: 'Shield',
          badgeColor: '#737373',
          providerIdentity: { provider: 'github', owner: 'octopusshield', repo: 'shield' },
          sourceRepoIds: [windowsRepo.id],
          createdAt: 5,
          updatedAt: 5
        }
      ],
      setups: [
        {
          id: 'win-setup',
          projectId: 'github:octopusshield/octopus-shield',
          hostId: 'local',
          repoId: windowsRepo.id,
          path: windowsRepo.path,
          displayName: 'shield',
          setupState: 'ready',
          setupMethod: 'imported-existing-folder',
          createdAt: 5,
          updatedAt: 5
        }
      ]
    }
  },
  {
    target: { kind: 'environment', environmentId: 'm4air' },
    hostId: 'runtime:m4air',
    repos: [
      hostRepo('m4-shield', '/Users/m4air/shield/shield'),
      hostRepo('m4-shield-two', '/Users/m4air/shield-two/shield')
    ],
    lists: null
  }
]

/** Workspace rows; activity order differs from catalog order, so Recent and Manual disagree. */
export const PROJECT_SECTION_PARITY_ROWS: readonly {
  id: string
  repoId: string
  lastActivityAt: number
}[] = [
  { id: 'wt-m4-two', repoId: 'm4-shield-two', lastActivityAt: 90 },
  { id: 'wt-win', repoId: 'win-shield', lastActivityAt: 70 },
  { id: 'wt-workspace', repoId: 'local-workspace', lastActivityAt: 50 },
  { id: 'wt-stably', repoId: 'local-stably', lastActivityAt: 30 },
  { id: 'wt-m4', repoId: 'm4-shield', lastActivityAt: 10 }
]

const SHARED = { key: 'project:github:octopusshield/octopus-shield', label: 'stably/shield' }
const WORKSPACE = { key: 'project:repo:local-workspace', label: 'shield/shield' }
const M4_TWO = { key: 'project:repo:m4-shield-two', label: 'shield' }
const ASSETS = { key: 'project:repo:local-assets', label: 'design-assets' }

export const PROJECT_SECTION_PARITY_HEADERS = {
  recent: [M4_TWO, SHARED, WORKSPACE, ASSETS],
  manual: [SHARED, ASSETS, WORKSPACE, M4_TWO]
} as const

/** What main serves the phone for these answers (the renderer's published catalog). */
export const OLD_PROJECT_SECTION_PARITY_SERVED: MobileProjectSectionCatalog = {
  repos: [
    {
      id: 'local-stably',
      displayName: 'shield',
      path: '/Users/jinwoo/stably/shield',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'local-assets',
      displayName: 'design-assets',
      path: '/Users/jinwoo/design-assets',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'local-workspace',
      displayName: 'shield',
      path: '/Users/jinwoo/shield/workspaces/shield/shield',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'local'
    },
    {
      id: 'win-shield',
      displayName: 'shield',
      path: 'C:/Users/jinwo/shield/shield',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:windows2'
    },
    {
      id: 'm4-shield',
      displayName: 'shield',
      path: '/Users/m4air/shield/shield',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:m4air'
    },
    {
      id: 'm4-shield-two',
      displayName: 'shield',
      path: '/Users/m4air/shield-two/shield',
      badgeColor: '#737373',
      addedAt: 1,
      executionHostId: 'runtime:m4air'
    }
  ],
  projects: [
    { id: 'repo:local-assets', displayName: 'design-assets' },
    { id: 'github:octopusshield/octopus-shield', displayName: 'shield' }
  ],
  setups: [
    {
      id: 'local-stably',
      projectId: 'github:octopusshield/octopus-shield',
      hostId: 'local',
      repoId: 'local-stably',
      path: '/Users/jinwoo/stably/shield',
      displayName: 'shield',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'local-assets',
      projectId: 'repo:local-assets',
      hostId: 'local',
      repoId: 'local-assets',
      path: '/Users/jinwoo/design-assets',
      displayName: 'design-assets',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'local-workspace',
      projectId: 'github:octopusshield/octopus-shield',
      hostId: 'local',
      repoId: 'local-workspace',
      path: '/Users/jinwoo/shield/workspaces/shield/shield',
      displayName: 'shield',
      setupMethod: 'legacy-repo'
    },
    {
      id: 'win-setup',
      projectId: 'github:octopusshield/octopus-shield',
      hostId: 'runtime:windows2',
      repoId: 'win-shield',
      path: 'C:/Users/jinwo/shield/shield',
      displayName: 'shield',
      setupMethod: 'imported-existing-folder',
      connectionId: null,
      executionHostId: 'runtime:windows2'
    },
    {
      id: 'm4-shield',
      projectId: 'github:octopusshield/octopus-shield',
      hostId: 'runtime:m4air',
      repoId: 'm4-shield',
      path: '/Users/m4air/shield/shield',
      displayName: 'shield',
      setupMethod: 'legacy-repo',
      executionHostId: 'runtime:m4air'
    },
    {
      id: 'm4-shield-two',
      projectId: 'github:octopusshield/octopus-shield',
      hostId: 'runtime:m4air',
      repoId: 'm4-shield-two',
      path: '/Users/m4air/shield-two/shield',
      displayName: 'shield',
      setupMethod: 'legacy-repo',
      executionHostId: 'runtime:m4air'
    }
  ],
  projectOrderBy: 'manual'
}

/** Current publisher identities; the old snapshot above remains an accepted peer payload. */
export const PROJECT_SECTION_PARITY_SERVED: MobileProjectSectionCatalog = {
  ...OLD_PROJECT_SECTION_PARITY_SERVED,
  projects: [
    { id: 'repo:local-assets', displayName: 'design-assets' },
    { id: 'repo:local-workspace', displayName: 'shield' },
    { id: 'github:octopusshield/octopus-shield', displayName: 'shield' },
    { id: 'repo:m4-shield-two', displayName: 'shield' }
  ],
  setups: OLD_PROJECT_SECTION_PARITY_SERVED.setups.map((setup) =>
    setup.repoId === 'local-workspace' || setup.repoId === 'm4-shield-two'
      ? { ...setup, projectId: `repo:${setup.repoId}` }
      : setup
  )
}
