import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OCTOPOD_MIGRATION_MANIFEST_VERSION } from '../../shared/octopod-migration/octopod-migration-manifest-validation'
import type { OctopodMigrationManifest } from '../../shared/octopod-migration/octopod-migration-manifest'
import { OCTOPOD_MIGRATION_SOURCE_KIND_UNKNOWN } from '../../shared/octopod-migration/octopod-migration-source-kind'
import {
  OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
  OCTOPOD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
} from '../../shared/octopod-runtime-capabilities'
import { encodePairingOffer, PAIRING_OFFER_VERSION } from '../../shared/pairing'
import { computeOctopodMigrationManifestSha256 } from '../octopod/octopod-migration-manifest-digest'

const sendRequest = vi.hoisted(() => vi.fn())
const status = vi.hoisted((): { capabilities: string[] } => ({ capabilities: [] }))
vi.mock('../../shared/remote-runtime/remote-runtime-client', () => ({
  sendRemoteRuntimeRequestWithStatusPreflight: async (
    pairing: unknown,
    method: string,
    params: unknown,
    _timeoutMs: number,
    validate: (response: unknown) => void
  ) => {
    validate({
      ok: true,
      _meta: { runtimeId: 'runtime' },
      result: { capabilities: status.capabilities }
    })
    return sendRequest(pairing, method, params)
  }
}))

const {
  OCTOPOD_MIGRATION_DESTINATION_SOURCE_KIND_UNSUPPORTED,
  abortRemoteOctopodMigrationCatalog,
  commitRemoteOctopodMigrationCatalog,
  readRemoteOctopodMigrationCatalogState,
  stageRemoteOctopodMigrationCatalog
} = await import('./octopod-migration-catalog-client')

const OPERATIONS = [
  stageRemoteOctopodMigrationCatalog,
  commitRemoteOctopodMigrationCatalog,
  readRemoteOctopodMigrationCatalogState,
  abortRemoteOctopodMigrationCatalog
]

function sshManifest(): OctopodMigrationManifest {
  const unsigned = {
    version: OCTOPOD_MIGRATION_MANIFEST_VERSION,
    migrationId: 'migration-kind',
    createdAt: '2026-10-01T00:00:00.000Z',
    source: { sshTargetId: 'ssh-prod', sshTargetGeneration: 7, targetLabel: 'Production' },
    payload: { repositories: [], projectGroups: [], folderWorkspaces: [] }
  }
  return { ...unsigned, manifestSha256: computeOctopodMigrationManifestSha256(unsigned) }
}

/** Include unknown wire kinds from newer or malformed peers. */
function manifestOfKind(kind: string): OctopodMigrationManifest {
  const source: OctopodMigrationManifest['source'] = {
    kind: 'local-wsl',
    distro: 'Ubuntu',
    scopeRepoIds: [],
    scopeFolderWorkspaceIds: [],
    generation: 1
  }
  Object.assign(source, { kind })
  return { ...sshManifest(), source }
}

const pairingCode = encodePairingOffer({
  v: PAIRING_OFFER_VERSION,
  endpoint: 'ws://127.0.0.1:46768/runtime',
  deviceToken: 'device-token',
  publicKeyB64: 'public-key',
  pairedDeviceId: 'paired-desktop'
})

beforeEach(() => {
  vi.clearAllMocks()
  sendRequest.mockResolvedValue({ ok: false, error: { code: 'x', message: 'sent' } })
  status.capabilities = [OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY]
})

describe('octopod migration source-kind capability gate', () => {
  it.each(OPERATIONS)('sends an SSH manifest unchanged to an older destination', async (op) => {
    await expect(op(pairingCode, sshManifest())).rejects.toThrow('sent')
    expect(sendRequest).toHaveBeenCalledTimes(1)
    const params = sendRequest.mock.calls[0][2]
    expect(params).toEqual({ manifest: sshManifest() })
    expect(JSON.stringify(params)).not.toContain('"kind"')
  })

  it.each(OPERATIONS)('never sends a WSL manifest to an older destination', async (op) => {
    await expect(op(pairingCode, manifestOfKind('local-wsl'))).rejects.toThrow(
      OCTOPOD_MIGRATION_DESTINATION_SOURCE_KIND_UNSUPPORTED
    )
    expect(sendRequest).not.toHaveBeenCalled()
  })

  it.each(OPERATIONS)('sends a WSL manifest once the destination advertises it', async (op) => {
    status.capabilities = [
      OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
      OCTOPOD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
    ]
    await expect(op(pairingCode, manifestOfKind('local-wsl'))).rejects.toThrow('sent')
    expect(sendRequest).toHaveBeenCalledTimes(1)
  })

  it.each(['ssh-relay', 'wsl', ''])(
    'refuses an unregistered kind %j before any request',
    async (kind) => {
      status.capabilities = [
        OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY,
        OCTOPOD_MIGRATION_LOCAL_WSL_SOURCE_RUNTIME_CAPABILITY
      ]
      await expect(
        stageRemoteOctopodMigrationCatalog(pairingCode, manifestOfKind(kind))
      ).rejects.toThrow(OCTOPOD_MIGRATION_SOURCE_KIND_UNKNOWN)
      expect(sendRequest).not.toHaveBeenCalled()
    }
  )
})
