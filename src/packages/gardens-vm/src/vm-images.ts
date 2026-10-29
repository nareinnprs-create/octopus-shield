import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type VmImageId = 'alpine-virt' | 'ubuntu-cloud'

export type VmImageEntry = {
  id: VmImageId
  /** Canonical file name on disk under the gardens images dir. */
  file: string
  url: string
  sha256: string
  /** Where the pin was read from; re-verify against this when refreshing. */
  sha256Source: string
  /** Hard cap; downloads past it are refused before hashing. */
  maxBytes: number
  notes: string
}

/**
 * Pins read 2026-10-28 from the upstream SHA256 sources below. Never boot an image whose
 * digest does not match its pin; refresh the pin (and the source citation) together.
 */
export const VM_IMAGE_CATALOG: readonly VmImageEntry[] = [
  {
    id: 'alpine-virt',
    file: 'alpine-virt-3.24.3-x86_64.iso',
    url: 'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-virt-3.24.3-x86_64.iso',
    sha256: 'cdc1bc0efc64d8d611bf3733f54868172a545888dfd726f518bf279bcb0ff1af',
    sha256Source:
      'https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/x86_64/alpine-virt-3.24.3-x86_64.iso.sha256',
    maxBytes: 256 * 1024 * 1024,
    notes: 'boot-tested headless via QEMU serial (kernel line within 120s, TCG)'
  },
  {
    id: 'ubuntu-cloud',
    file: 'noble-server-cloudimg-amd64.img',
    url: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img',
    sha256: '04e8f2461a16a44e78a370284471f29616cdd9baf1893df25807b71f985b6c94',
    sha256Source: 'https://cloud-images.ubuntu.com/noble/current/SHA256SUMS',
    maxBytes: 2 * 1024 * 1024 * 1024,
    notes:
      'documented only (not boot-tested): qcow2 needing a cloud-init NoCloud seed ISO for credentials'
  }
]

export const vmImageById = (id: string): VmImageEntry | undefined =>
  VM_IMAGE_CATALOG.find((entry) => entry.id === id)

/** Structural subset of the DOM fetch Response; callers inject (Node globalThis.fetch fits). */
export type FetchLike = (
  url: string,
  init?: { method?: string }
) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer> }>

export type VmImageDownloadResult =
  | { ok: true; path: string; sha256: string; bytes: number }
  | { ok: false; reason: string }

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex')

/**
 * Download → hash → pin-verify → atomic rename. The fetch is always injected; nothing here
 * touches the network implicitly, so tests pass a fake fetchLike.
 */
export const downloadVmImage = async (
  entry: VmImageEntry,
  destDir: string,
  fetchLike: FetchLike,
  expectedSha256: string = entry.sha256
): Promise<VmImageDownloadResult> => {
  const response = await fetchLike(entry.url, { method: 'GET' })
  if (!response.ok) {
    return { ok: false, reason: `download failed for ${entry.id}: HTTP ${String(response.status)}` }
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > entry.maxBytes) {
    return {
      ok: false,
      reason: `download for ${entry.id} exceeds cap: ${String(bytes.length)} > ${String(entry.maxBytes)}`
    }
  }
  const actual = sha256Hex(bytes)
  if (actual !== expectedSha256.toLowerCase()) {
    return {
      ok: false,
      reason: `sha256 mismatch for ${entry.id}: expected ${expectedSha256.toLowerCase()}, got ${actual} (source: ${entry.sha256Source})`
    }
  }
  mkdirSync(destDir, { recursive: true })
  const destination = join(destDir, entry.file)
  const staging = join(destDir, `${entry.file}.staging-${String(process.pid)}`)
  writeFileSync(staging, bytes)
  try {
    renameSync(staging, destination)
  } catch (error) {
    rmSync(staging, { force: true })
    return {
      ok: false,
      reason: `rename into place failed: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  return { ok: true, path: destination, sha256: actual, bytes: bytes.length }
}
