import { describe, expect, it } from 'vitest'
import { getLocalExecutionHostLabel } from '../../../src/shared/execution-host'
import {
  buildNewWorkspaceProjectOptions,
  buildNewWorkspaceRunTargetOptions,
  getNewWorkspaceRunTarget
} from './new-workspace-project-targets'

const LOCAL_HOST_LABEL = getLocalExecutionHostLabel('darwin')

describe('new workspace project targets', () => {
  it('groups local and SSH checkouts of the same project', () => {
    const upstream = { owner: 'octopusshield', repo: 'shield' }
    const options = buildNewWorkspaceProjectOptions([
      { id: 'local', displayName: 'shield', path: '/src/shield', upstream },
      {
        id: 'ssh',
        displayName: 'shield',
        path: '/home/dev/shield',
        connectionId: 'build-server',
        upstream
      }
    ])

    expect(options).toHaveLength(1)
    expect(options[0]).toMatchObject({ label: 'shield', detail: 'octopusshield/octopus-shield' })
  })

  it('shows the provider slug recovered from canonical git identity', () => {
    const options = buildNewWorkspaceProjectOptions([
      {
        id: 'local',
        displayName: 'shield',
        path: '/src/shield',
        gitRemoteIdentity: {
          canonicalKey: 'github.com/octopusshield/octopus-shield',
          remoteName: 'origin',
          remoteUrl: 'git@github.com:octopusshield/octopus-shield.git'
        }
      }
    ])

    expect(options[0]).toMatchObject({ label: 'shield', detail: 'octopusshield/octopus-shield' })
  })

  it('labels local, SSH, and paired runtime targets as the host list names them', () => {
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'shield', path: '/src/shield' }, 'darwin')
    ).toEqual({ hostId: 'local', label: LOCAL_HOST_LABEL, detail: '/src/shield' })
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'shield', path: 'C:\\src\\shield' })
    ).toMatchObject({ label: 'This computer' })
    expect(
      getNewWorkspaceRunTarget({ id: 'local', displayName: 'shield', path: 'C:\\src\\shield' }, 'win32')
    ).toMatchObject({ label: 'Local Windows' })
    expect(
      getNewWorkspaceRunTarget({
        id: 'ssh',
        displayName: 'shield',
        path: 'C:\\src\\shield',
        executionHostId: 'ssh:Windows%20VM'
      })
    ).toEqual({ hostId: 'ssh:Windows%20VM', label: 'Windows VM', detail: 'C:\\src\\shield' })
    const server = {
      id: 'runtime',
      displayName: 'shield',
      path: '/src/shield',
      executionHostId: 'runtime:20269ff3-60aa-4e79-a581-513a3f8e394b'
    } as const
    const labels = new Map([[server.executionHostId, 'scratch-server']] as const)
    expect(getNewWorkspaceRunTarget(server, 'darwin', labels)).toEqual({
      hostId: server.executionHostId,
      label: 'scratch-server',
      detail: '/src/shield'
    })
  })

  it('keeps each same-host clone selectable with its concrete target', () => {
    const upstream = { owner: 'octopusshield', repo: 'shield' }
    const repos = [
      { id: 'local-a', displayName: 'shield-a', path: '/src/shield-a', upstream },
      { id: 'local-b', displayName: 'shield-b', path: '/src/shield-b', upstream },
      {
        id: 'ssh',
        displayName: 'shield',
        path: '/home/dev/shield',
        connectionId: 'build-server',
        upstream
      }
    ]
    const projects = buildNewWorkspaceProjectOptions(repos)
    expect(projects.map((project) => project.id)).toEqual(['github:octopusshield/octopus-shield', 'repo:local-b'])
    expect(buildNewWorkspaceRunTargetOptions(repos, 'repo:local-b')[0]?.repo).toBe(repos[1])
    const projectId = projects[0]?.id ?? null

    expect(buildNewWorkspaceRunTargetOptions(repos, projectId, 'darwin')).toEqual([
      expect.objectContaining({ id: 'local', label: LOCAL_HOST_LABEL, detail: '/src/shield-a' }),
      expect.objectContaining({
        id: 'ssh:build-server',
        label: 'build-server',
        detail: '/home/dev/shield'
      })
    ])
  })
  it('uses the complete claim catalog before hiding ineligible create targets', () => {
    const upstream = { owner: 'acme', repo: 'app' }
    const repos = [
      { id: 'a', displayName: 'A', path: '', addedAt: 1, upstream },
      { id: 'b', displayName: 'B', path: '/b', addedAt: 2, upstream }
    ]
    expect(buildNewWorkspaceProjectOptions(repos).map((project) => project.id)).toEqual(['repo:b'])
    expect(buildNewWorkspaceRunTargetOptions(repos, 'repo:b')[0]?.repo).toBe(repos[1])
  })
})
