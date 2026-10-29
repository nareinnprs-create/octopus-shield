import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getManagedOctopodFenceEnvironmentId } from '../../shared/managed-octopod-ssh-owner'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'
import { addManagedOctopodEnvironment } from '../../shared/runtime-environment-managed-octopod-store'
import { listEnvironments, resolveEnvironment } from '../../shared/runtime-environment-store'
import type { Repo } from '../../shared/repo-types'
import type { SshTarget } from '../../shared/ssh-types'
import { folderWorkspaceKey } from '../../shared/workspace-scope'
import { closeTestStores, createSqliteTestStore } from '../persistence/persistence-test-harness'
import { Store } from '../persistence/loading-store/store'
import { listOctopodMigrationSourceCutovers } from './octopod-migration-cutover-journal'
import { fakeOctopodMigrationDestination } from './octopod-migration-destination-fake'
import { runOctopodDeltaMove } from './octopod-migration-delta-move'
import { reconcileManagedOctopodSshTargets } from './octopod-retained-source'
import { SshConnectionStore } from './connection/ssh-connection-store'
import { runTargetLifecycle } from '../ipc/ssh/ssh-target-lifecycle-queue'

const mocks = vi.hoisted(() => {
  const state: { targetStore: unknown } = { targetStore: null }
  return { state, deploy: vi.fn(), ensureTunnel: vi.fn() }
})
vi.mock('./targets/ssh-target-registry', () => ({
  getSshConnectionManager: () => ({}),
  getSshTargetRegistryStore: () => mocks.state.targetStore
}))
vi.mock('../managed-server/lifecycle/octopod-runtime-deployment', () => ({
  createManagedOctopodEnvironment: mocks.deploy
}))
vi.mock('../managed-server/lifecycle/octopod-managed-tunnel', () => ({
  ensureOctopodManagedTunnel: mocks.ensureTunnel
}))

const { convertSshTargetToManagedOctopod } =
  await import('../managed-server/lifecycle/octopod-runtime-conversion')

const TARGET: SshTarget = {
  id: 'ssh-prod',
  label: 'Production',
  host: 'prod.example.com',
  port: 22,
  username: 'deploy',
  generation: 2
}

let userDataPath: string
let store: Store
let sshStore: SshConnectionStore
let destination: ReturnType<typeof fakeOctopodMigrationDestination>

function repo(id: string, path: string): Repo {
  return {
    id,
    path,
    displayName: id,
    badgeColor: '#737373',
    addedAt: 1,
    kind: 'git',
    connectionId: TARGET.id
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  userDataPath = mkdtempSync(join(tmpdir(), 'octopod-delta-snapshot-'))
  store = createSqliteTestStore(Store, { dataFile: join(userDataPath, 'shield-data.json') })
  store.addSshTarget(TARGET)
  store.addRepo(repo('repo-1', '/srv/app'))
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: SshConnectionStore wraps the real test store it is given.
  sshStore = new SshConnectionStore(store as never)
  mocks.state.targetStore = sshStore
  destination = fakeOctopodMigrationDestination()
  mocks.ensureTunnel.mockImplementation(resolveEnvironment)
  mocks.deploy.mockImplementation(async (path: string, args: { name: string }) => {
    const id = getManagedOctopodFenceEnvironmentId(store.getSshTarget(TARGET.id))!
    if (!listEnvironments(path).some((entry) => entry.id === id)) {
      addManagedOctopodEnvironment(path, {
        id,
        name: args.name,
        pairingCode: encodePairingOffer({
          v: PAIRING_OFFER_VERSION,
          endpoint: 'ws://127.0.0.1:46768/',
          deviceToken: 'device-token',
          publicKeyB64: 'public-key'
        }),
        octopodDeployment: {
          sshTargetId: TARGET.id,
          sshTargetGeneration: 2,
          localPort: 46_768,
          remotePort: 6_768
        }
      })
    }
    return { outcome: 'created', environment: {}, activeVersion: '1.0.0' }
  })
})

afterEach(async () => {
  await closeTestStores()
  rmSync(userDataPath, { recursive: true, force: true })
})

const now = () => new Date('2026-10-03T00:00:00.000Z')

const HOST_ID = `ssh:${TARGET.id}` as const

function saveDraft(worktreeId: string, content: string): void {
  store.setWorkspaceSession(
    {
      ...store.getWorkspaceSession(HOST_ID),
      openFilesByWorktree: {
        [worktreeId]: [
          {
            filePath: '/srv/notes.md',
            relativePath: 'notes.md',
            worktreeId,
            language: 'markdown',
            dirtyDraftContent: content
          }
        ]
      }
    },
    HOST_ID
  )
}

function savedDraft(worktreeId: string): string | undefined {
  return store.getWorkspaceSession(HOST_ID).openFilesByWorktree?.[worktreeId]?.[0]
    ?.dirtyDraftContent
}

async function convertedThenAdded(addOnOlderBuild: () => string): Promise<string> {
  await expect(
    convertSshTargetToManagedOctopod(userDataPath, {
      sshTargetId: TARGET.id,
      name: 'Managed',
      censusHost: async () => ({ verdict: 'exited', count: 0 }),
      destinationFor: () => destination,
      now
    })
  ).resolves.toMatchObject({ outcome: 'converted' })
  const worktreeId = addOnOlderBuild()
  saveDraft(worktreeId, 'draft before the move')
  reconcileManagedOctopodSshTargets(userDataPath, store, now)
  expect(store.getSshTarget(TARGET.id)?.octopodFence?.sourceChangedAt).toBeDefined()
  return worktreeId
}

/** Run the user edit before answering census to model typing during preflight. */
function deltaMoveTypingDuringTerminalCheck(whileChecking: () => void) {
  return runOctopodDeltaMove({
    userDataPath,
    store,
    claims: sshStore.getOctopodRuntimeClaims(),
    target: store.getSshTarget(TARGET.id)!,
    environment: listEnvironments(userDataPath)[0]!,
    connectDestination: async () => destination,
    censusHost: async () => {
      whileChecking()
      return { verdict: 'exited', count: 0 }
    },
    runTargetLifecycle,
    now
  })
}

describe('a draft typed while a delta move checks terminals', () => {
  it.each([
    [
      'a repository the older build added',
      () => {
        store.addRepo(repo('repo-2', '/srv/tool'))
        return 'repo-2::/srv/tool'
      }
    ],
    [
      'a folder workspace the older build added',
      () => {
        const group = store.createProjectGroup({
          name: 'folders',
          parentPath: '/srv/folders',
          connectionId: TARGET.id,
          createdFrom: 'manual'
        })
        const folder = store.createFolderWorkspace({
          projectGroupId: group.id,
          folderPath: '/srv/folders/notes',
          connectionId: TARGET.id
        })
        return folderWorkspaceKey(folder.id)
      }
    ]
  ])('in %s moves as planned and keeps the newer draft in the source', async (_label, add) => {
    const worktreeId = await convertedThenAdded(add)

    await expect(
      deltaMoveTypingDuringTerminalCheck(() =>
        saveDraft(worktreeId, 'typed while the terminal check awaited')
      )
    ).resolves.toMatchObject({ outcome: 'moved' })

    // The server gets the draft the plan saw; the newer one stays in the retained rows.
    expect(destination.commits).toBe(2)
    expect(listOctopodMigrationSourceCutovers(userDataPath).every((j) => j.sourceRetainedAt)).toBe(
      true
    )
    expect(savedDraft(worktreeId)).toBe('typed while the terminal check awaited')
  })

  it('journals the baseline the manifest saw when nothing changed during the check', async () => {
    const worktreeId = await convertedThenAdded(() => {
      store.addRepo(repo('repo-2', '/srv/tool'))
      return 'repo-2::/srv/tool'
    })

    await expect(deltaMoveTypingDuringTerminalCheck(() => {})).resolves.toMatchObject({
      outcome: 'moved'
    })
    expect(savedDraft(worktreeId)).toBe('draft before the move')
    reconcileManagedOctopodSshTargets(userDataPath, store, now)
    expect(store.getSshTarget(TARGET.id)?.octopodFence?.sourceChangedAt).toBeUndefined()
  })
})
