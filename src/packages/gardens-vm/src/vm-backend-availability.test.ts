import { describe, expect, it } from 'vitest'
import {
  createHyperVBackend,
  hypervAvailabilityScript,
  buildHyperVNewVmScript
} from './vm-backend-hyperv'
import { createVzBackend } from './vm-backend-vz'
import {
  downloadVmImage,
  sha256Hex,
  VM_IMAGE_CATALOG,
  vmImageById,
  type VmImageEntry
} from './vm-images'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const imageEntry = (sha256: string): VmImageEntry => ({
  id: 'alpine-virt',
  file: 'alpine-virt-test.iso',
  url: 'https://images.invalid/alpine.iso',
  sha256,
  sha256Source: 'https://images.invalid/SHA256SUMS',
  maxBytes: 1024,
  notes: 'test entry'
})

describe('image hash pinning', () => {
  it('accepts a download whose digest matches the pin', async () => {
    const bytes = new TextEncoder().encode('alpine-test-bytes')
    const entry = imageEntry(sha256Hex(bytes))
    const dir = mkdtempSync(join(tmpdir(), 'gardens-images-ok-'))
    try {
      const result = await downloadVmImage(entry, dir, async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.sha256).toBe(entry.sha256)
        expect(existsSync(result.path)).toBe(true)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses and keeps nothing on a digest mismatch', async () => {
    const bytes = new TextEncoder().encode('tampered-bytes')
    const dir = mkdtempSync(join(tmpdir(), 'gardens-images-bad-'))
    try {
      const result = await downloadVmImage(imageEntry('dead'.repeat(16)), dir, async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('sha256 mismatch')
        expect(result.reason).toContain(`got ${sha256Hex(bytes)}`)
      }
      expect(existsSync(join(dir, 'alpine-virt-test.iso'))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses non-200 responses and over-cap downloads', async () => {
    const entry = imageEntry(sha256Hex(new TextEncoder().encode('x')))
    const refused = await downloadVmImage(entry, tmpdir(), async () => ({
      ok: false,
      status: 404,
      arrayBuffer: async () => new ArrayBuffer(0)
    }))
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.reason).toContain('HTTP 404')
    }
    const overCap = await downloadVmImage(entry, tmpdir(), async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(2048)
    }))
    expect(overCap.ok).toBe(false)
    if (!overCap.ok) {
      expect(overCap.reason).toContain('exceeds cap')
    }
  })

  it('ships both catalog entries with upstream pins cited', () => {
    expect(vmImageById('alpine-virt')).toBeDefined()
    expect(vmImageById('ubuntu-cloud')).toBeDefined()
    for (const entry of VM_IMAGE_CATALOG) {
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(entry.sha256Source).toMatch(/^https:\/\//)
    }
  })
})

describe('hyper-v backend (interface conformance; unavailable on this box)', () => {
  it('is unavailable off Windows', async () => {
    const backend = createHyperVBackend({
      dir: tmpdir(),
      platform: 'linux',
      runProcess: async () => ({ code: 0, signal: null, stdout: '', stderr: '', timedOut: false })
    })
    expect(await backend.available()).toBe(false)
    const verdict = await backend.availability()
    expect(verdict.available).toBe(false)
    expect(verdict.reason).toBe('Windows host required')
  })

  it('gates availability on vmcompute running AND admin elevation', async () => {
    expect(hypervAvailabilityScript).toContain('vmcompute')
    expect(hypervAvailabilityScript).toContain('IsInRole')
    const backend = createHyperVBackend({
      dir: tmpdir(),
      platform: 'win32',
      runProcess: async () => ({
        code: 0,
        signal: null,
        stdout: 'GARDENS_HYPERV_UNAVAILABLE service=Running admin=False',
        stderr: '',
        timedOut: false
      })
    })
    expect(await backend.available()).toBe(false)
  })

  it('builds generation-1 New-VM scripts with DVD attach for ISOs', () => {
    const script = buildHyperVNewVmScript(
      {
        name: 'eng-7',
        vcpus: 1,
        memoryMb: 512,
        diskGb: 2,
        imageRef: 'C:\\iso\\alpine.iso',
        natNetwork: false
      },
      'C:\\gardens\\eng-7.vhdx'
    )
    expect(script).toContain('New-VM -Name ')
    expect(script).toContain("-Name 'eng-7'")
    expect(script).toContain(String(512 * 1024 * 1024))
    expect(script).toContain(String(2 * 1024 * 1024 * 1024))
    expect(script).toContain("Add-VMDvdDrive -VMName 'eng-7' -Path 'C:\\iso\\alpine.iso'")
  })
})

describe('vz backend (interface conformance only)', () => {
  it('reports macOS-only availability honestly', async () => {
    const backend = createVzBackend()
    expect(backend.id).toBe('vz')
    expect(await backend.available()).toBe(false)
    const verdict = await backend.availability()
    expect(verdict.reason).toContain('macOS host required')
    await expect(
      backend.create({
        name: 'x',
        vcpus: 1,
        memoryMb: 512,
        diskGb: 1,
        imageRef: 'a',
        natNetwork: false
      })
    ).rejects.toThrow('macOS host required')
  })
})
