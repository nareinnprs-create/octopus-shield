import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { downloadVmImage, vmImageById, type FetchLike, type VmImageId } from './vm-images'
import {
  gardensVmAuditEvent,
  type GardensVmLifecycleRecord,
  type GardensVmOpResult
} from './gardens-vm-audit'

export type GardensVmCreateRequest = {
  name: string
  imageId?: VmImageId
  imageRef?: string
  vcpus?: number
  memoryMb?: number
  diskGb?: number
  natNetwork?: boolean
  /** Reserve a 127.0.0.1 hostfwd port to guest :22; recorded in metadata and on the handle. */
  ssh?: boolean
}

/** Explicit --image-ref wins; catalog ids resolve under the gardens images dir and must be materialized. */
export const resolveGardensImageRef = (
  request: Pick<GardensVmCreateRequest, 'imageRef' | 'imageId'>,
  imagesDir: string
): { ok: true; path: string } | { ok: false; reason: string } => {
  if (request.imageRef !== undefined) {
    if (!existsSync(request.imageRef)) {
      return { ok: false, reason: `imageRef does not exist: ${request.imageRef}` }
    }
    return { ok: true, path: request.imageRef }
  }
  const entry = vmImageById(request.imageId ?? 'alpine-virt')
  if (entry === undefined) {
    return { ok: false, reason: `unknown image id: ${String(request.imageId)}` }
  }
  const path = join(imagesDir, entry.file)
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `image ${entry.id} is not materialized at ${path}; run: gardens-vm image-download ${entry.id}`
    }
  }
  return { ok: true, path }
}

/** Fetch-injected catalog download wrapped in the manager's audit-record shape. */
export const downloadCatalogImage = async (
  imageId: VmImageId,
  imagesDir: string,
  fetchLike: FetchLike
): Promise<GardensVmOpResult> => {
  const entry = vmImageById(imageId)
  if (entry === undefined) {
    return { ok: false, reason: `unknown image id: ${String(imageId)}` }
  }
  const startedAt = Date.now()
  const result = await downloadVmImage(entry, imagesDir, fetchLike)
  const record: GardensVmLifecycleRecord = {
    operation: 'image-download',
    vmName: entry.id,
    backend: 'none',
    ok: result.ok,
    durationMs: Date.now() - startedAt,
    detail: result.ok ? `${String(result.bytes)} bytes at ${result.path}` : result.reason,
    audited: true
  }
  return result.ok
    ? { ok: true, record, audit: gardensVmAuditEvent(record) }
    : { ok: false, reason: result.reason, record, audit: gardensVmAuditEvent(record) }
}
