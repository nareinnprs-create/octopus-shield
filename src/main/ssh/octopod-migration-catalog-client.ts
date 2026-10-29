import { z } from 'zod'
import { pairedRuntimeConnectionFromOffer } from '../../shared/paired-runtime-connection'
import {
  parseOctopodMigrationCatalogAbortResult,
  parseOctopodMigrationCatalogState
} from '../../shared/octopod-migration/octopod-migration-catalog-state'
import type {
  OctopodMigrationCatalogAbortResult,
  OctopodMigrationCatalogState,
  OctopodMigrationManifest
} from '../../shared/octopod-migration/octopod-migration-manifest'
import {
  parseOctopodMigrationSnapshotChunkResult,
  type OctopodMigrationSnapshotChunkRequest,
  type OctopodMigrationSnapshotChunkResult
} from '../../shared/octopod-migration/octopod-migration-scrollback'
import {
  findUnsupportedMigrationBlobKind,
  octopodMigrationBlobKindUnsupportedBlocker,
  parseOctopodMigrationBlobChunkResult,
  type OctopodMigrationBlobChunkRequest,
  type OctopodMigrationBlobChunkResult,
  type OctopodMigrationBlobDescriptor
} from '../../shared/octopod-migration/octopod-migration-blob-transfer'
import { parsePairingCode } from '../../shared/pairing'
import { ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES } from '../../shared/electron-remote-runtime-client-capabilities'
import { OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY } from '../../shared/octopod-runtime-capabilities'
import { sendRemoteRuntimeRequestWithStatusPreflight } from '../../shared/remote-runtime/remote-runtime-client'
import { assertOctopodMigrationRequestFits } from './octopod-migration-manifest-export'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import { AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { hasExtraAgentArgs } from '../../shared/automation-extra-agent-args'
import { requiredOctopodMigrationSourceCapability } from '../../shared/octopod-migration/octopod-migration-source-kind'
import type { OctopodServerRepository } from './octopod-migration-repository-link'

type OctopodCatalogMigrationOperation = 'abort' | 'commit' | 'stage' | 'state'

/** Missing capability/method is definite refusal; other failures require catalog re-read because a lost reply may hide staged state. */
export const OCTOPOD_MIGRATION_DESTINATION_UNSUPPORTED = 'octopod_migration_destination_unsupported'
/** Refuse older destinations that would silently strip extra agent arguments. */
export const OCTOPOD_MIGRATION_DESTINATION_EXTRA_AGENT_ARGS_UNSUPPORTED =
  'octopod_migration_destination_extra_agent_args_unsupported:Update Shield on this host to use extra arguments.'
/** Unsupported source kinds are refused before any staging request. */
export const OCTOPOD_MIGRATION_DESTINATION_SOURCE_KIND_UNSUPPORTED =
  'octopod_migration_destination_source_kind_unsupported:Update Shield on this host to move this project to it.'

export type CatalogRequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
  expectedRuntimeId?: string
}

const METHOD_BY_OPERATION: Record<OctopodCatalogMigrationOperation, string> = {
  abort: 'octopod.migration.abortCatalog',
  commit: 'octopod.migration.commitCatalog',
  stage: 'octopod.migration.stageCatalog',
  state: 'octopod.migration.catalogState'
}

export function stageRemoteOctopodMigrationCatalog(
  pairingCode: string,
  manifest: OctopodMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<OctopodMigrationCatalogState> {
  return requestCatalogState(pairingCode, 'stage', manifest, options)
}

/** Expected blobs make the destination refuse incomplete commits. */
export async function commitRemoteOctopodMigrationCatalog(
  pairingCode: string,
  manifest: OctopodMigrationManifest,
  options: CatalogRequestOptions & {
    expectedBlobs?: readonly OctopodMigrationBlobDescriptor[]
  } = {}
): Promise<OctopodMigrationCatalogState> {
  const result = await request(pairingCode, 'commit', manifest, options, options.expectedBlobs)
  return parseOctopodMigrationCatalogState(result, manifest)
}

export function readRemoteOctopodMigrationCatalogState(
  pairingCode: string,
  manifest: OctopodMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<OctopodMigrationCatalogState> {
  return requestCatalogState(pairingCode, 'state', manifest, options)
}

export async function abortRemoteOctopodMigrationCatalog(
  pairingCode: string,
  manifest: OctopodMigrationManifest,
  options: CatalogRequestOptions = {}
): Promise<OctopodMigrationCatalogAbortResult> {
  const result = await request(pairingCode, 'abort', manifest, options)
  const parsed = parseOctopodMigrationCatalogAbortResult(result, manifest)
  // Older already-absent replies prove no durability, unlike real aborts.
  if (parsed.state === 'absent' && !parsed.aborted && parsed.durableAbsent !== true) {
    throw new Error('octopod_migration_abort_durability_unverifiable:destination_update_required')
  }
  return parsed
}

export async function stageRemoteOctopodMigrationSnapshotChunk(
  pairingCode: string,
  request: OctopodMigrationSnapshotChunkRequest,
  options: CatalogRequestOptions = {}
): Promise<OctopodMigrationSnapshotChunkResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('octopod_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(
    pairing,
    'octopod.migration.stageSnapshotChunk',
    request,
    options
  )
  if (!response.ok) {
    throw new Error(`octopod_migration_snapshot_failed:${response.error.message}`)
  }
  return parseOctopodMigrationSnapshotChunkResult(response.result, request)
}

export async function stageRemoteOctopodMigrationBlobChunk(
  pairingCode: string,
  request: OctopodMigrationBlobChunkRequest,
  options: CatalogRequestOptions = {}
): Promise<OctopodMigrationBlobChunkResult> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('octopod_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(
    pairing,
    'octopod.migration.stageBlobChunk',
    request,
    options,
    false,
    null,
    // Recheck every request so a downgraded destination cannot stage an unsupported blob kind.
    (capabilities) => {
      const unsupported = findUnsupportedMigrationBlobKind([request.blob], capabilities)
      if (unsupported) {
        throw new Error(octopodMigrationBlobKindUnsupportedBlocker(unsupported))
      }
    }
  )
  if (!response.ok) {
    throw new Error(`octopod_migration_blob_failed:${response.error.message}`)
  }
  return parseOctopodMigrationBlobChunkResult(response.result, request)
}

export async function listServerRows(
  pairingCode: string,
  method: string,
  rows: string,
  options: CatalogRequestOptions
): Promise<unknown> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('octopod_migration_pairing_code_invalid')
  }
  const response = await sendSupportedMigrationRequest(pairing, method, undefined, options)
  if (!response.ok) {
    throw new Error(`octopod_migration_${rows}_failed:${response.error.message}`)
  }
  return response.result
}

// repo.list returns full stored rows; omitted host fields identify server-local repos.
const ServerRepositoriesSchema = z.object({
  repos: z.array(
    z.object({
      id: z.string().min(1),
      path: z.string().min(1),
      connectionId: z.string().nullish(),
      executionHostId: z.string().nullish(),
      projectGroupId: z.string().nullish()
    })
  )
})

export async function listRemoteOctopodRepositories(
  pairingCode: string,
  options: CatalogRequestOptions = {}
): Promise<OctopodServerRepository[]> {
  const result = await listServerRows(pairingCode, 'repo.list', 'repositories', options)
  return ServerRepositoriesSchema.parse(result).repos.map(
    ({ id, path, connectionId, executionHostId, projectGroupId }) => ({
      id,
      path,
      ...(connectionId != null ? { connectionId } : {}),
      ...(executionHostId != null ? { executionHostId } : {}),
      ...(projectGroupId != null ? { projectGroupId } : {})
    })
  )
}

async function requestCatalogState(
  pairingCode: string,
  operation: Exclude<OctopodCatalogMigrationOperation, 'abort'>,
  manifest: OctopodMigrationManifest,
  options: CatalogRequestOptions
): Promise<OctopodMigrationCatalogState> {
  const result = await request(pairingCode, operation, manifest, options)
  return parseOctopodMigrationCatalogState(result, manifest)
}

async function request(
  pairingCode: string,
  operation: OctopodCatalogMigrationOperation,
  manifest: OctopodMigrationManifest,
  options: CatalogRequestOptions,
  expectedBlobs: readonly OctopodMigrationBlobDescriptor[] = []
): Promise<unknown> {
  const pairing = parsePairingCode(pairingCode)
  if (!pairing) {
    throw new Error('octopod_migration_pairing_code_invalid')
  }
  // Preserve exact { manifest } wire shape for blob-free and SSH moves.
  const params = expectedBlobs.length > 0 ? { manifest, expectedBlobs } : { manifest }
  // Validation-size limits can exceed sealed-frame capacity; reject before the host closes the socket.
  assertOctopodMigrationRequestFits(params)
  const carriesExtraAgentArgs =
    (operation === 'stage' || operation === 'commit') &&
    (manifest.payload.dormantState?.automations ?? []).some((automation) =>
      hasExtraAgentArgs(automation.extraAgentArgs)
    )
  const response = await sendSupportedMigrationRequest(
    pairing,
    METHOD_BY_OPERATION[operation],
    params,
    options,
    carriesExtraAgentArgs,
    // Recheck source capabilities on every operation; older hosts may misparse non-SSH sources.
    requiredOctopodMigrationSourceCapability(manifest.source),
    // Hosts without blob capability would strip expectedBlobs and commit unchecked.
    (capabilities) => {
      const unsupported = findUnsupportedMigrationBlobKind(expectedBlobs, capabilities)
      if (unsupported) {
        throw new Error(octopodMigrationBlobKindUnsupportedBlocker(unsupported))
      }
    }
  )
  if (!response.ok) {
    throw new Error(`octopod_migration_${operation}_failed:${response.error.message}`)
  }
  return response.result
}

export async function sendSupportedMigrationRequest(
  pairing: NonNullable<ReturnType<typeof parsePairingCode>>,
  method: string,
  params: unknown,
  options: CatalogRequestOptions,
  requiresExtraAgentArgs = false,
  requiredSourceCapability: string | null = null,
  assertCapabilities: (capabilities: readonly string[]) => void = () => {}
): Promise<RuntimeRpcResponse<unknown>> {
  const response = await sendRemoteRuntimeRequestWithStatusPreflight<unknown>(
    pairedRuntimeConnectionFromOffer(pairing),
    method,
    params,
    options.timeoutMs ?? 15_000,
    (status) => {
      if (!status.ok) {
        throw new Error(`octopod_migration_status_failed:${status.error.message}`)
      }
      if (
        options.expectedRuntimeId !== undefined &&
        status._meta?.runtimeId !== options.expectedRuntimeId
      ) {
        throw new Error('octopod_migration_destination_runtime_mismatch')
      }
      if (!status.result.capabilities?.includes(OCTOPOD_MIGRATION_CATALOG_RUNTIME_CAPABILITY)) {
        throw new Error(OCTOPOD_MIGRATION_DESTINATION_UNSUPPORTED)
      }
      if (
        requiresExtraAgentArgs &&
        !status.result.capabilities?.includes(AUTOMATION_EXTRA_AGENT_ARGS_RUNTIME_CAPABILITY)
      ) {
        throw new Error(OCTOPOD_MIGRATION_DESTINATION_EXTRA_AGENT_ARGS_UNSUPPORTED)
      }
      if (
        requiredSourceCapability !== null &&
        !status.result.capabilities?.includes(requiredSourceCapability)
      ) {
        throw new Error(OCTOPOD_MIGRATION_DESTINATION_SOURCE_KIND_UNSUPPORTED)
      }
      assertCapabilities(status.result.capabilities ?? [])
    },
    undefined,
    ELECTRON_REMOTE_RUNTIME_CLIENT_CAPABILITIES,
    options.signal
  )
  if (!response.ok && response.error.code === 'method_not_found') {
    throw new Error(OCTOPOD_MIGRATION_DESTINATION_UNSUPPORTED)
  }
  if (
    options.expectedRuntimeId !== undefined &&
    response._meta?.runtimeId !== options.expectedRuntimeId
  ) {
    throw new Error('octopod_migration_destination_runtime_mismatch')
  }
  return response
}
