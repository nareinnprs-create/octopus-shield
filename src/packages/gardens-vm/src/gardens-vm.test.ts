import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GardensVmManager,
  gardensVmAuditEvent,
  parseGardensScope,
  scopeFromEnv,
  vmNameInScope,
  type GardensVmOpResult
} from './gardens-vm'
import type { VmBackend, VmDiskSnapshot, VmHandle, VmInspectInfo, VmSpec } from './vm-backend'

const fakeHandle = (backend: VmBackend['id'], name: string): VmHandle => ({
  id: name,
  backend,
  state: 'created'
})

const scriptedBackend = (
  id: VmBackend['id'],
  options: { available: boolean; calls?: string[]; failCreateWith?: string }
): VmBackend => ({
  id,
  available: async () => options.available,
  create: async (spec: VmSpec) => {
    options.calls?.push(`create:${spec.name}`)
    if (options.failCreateWith !== undefined) {
      throw new Error(options.failCreateWith)
    }
    return fakeHandle(id, spec.name)
  },
  start: async (handle: VmHandle) => {
    options.calls?.push(`start:${handle.id}`)
    return { ...handle, state: 'running' }
  },
  stop: async (handle: VmHandle) => {
    options.calls?.push(`stop:${handle.id}`)
    return { ...handle, state: 'stopped' }
  },
  status: async (handle: VmHandle) => {
    options.calls?.push(`status:${handle.id}`)
    return 'stopped'
  },
  delete: async (handle: VmHandle) => {
    options.calls?.push(`delete:${handle.id}`)
  }
})

describe('gardens scope', () => {
  it('is deny-by-default', () => {
    expect(parseGardensScope(undefined).size).toBe(0)
    expect(parseGardensScope('  ').size).toBe(0)
    expect(vmNameInScope(parseGardensScope('eng-7'), 'anything')).toBe(false)
  })

  it('authorizes exact prefix and hyphen-prefixed names only', () => {
    const scope = parseGardensScope('eng-7, sp-42')
    expect(vmNameInScope(scope, 'eng-7')).toBe(true)
    expect(vmNameInScope(scope, 'eng-7-det')).toBe(true)
    expect(vmNameInScope(scope, 'eng-77')).toBe(false)
    expect(vmNameInScope(scope, 'sp-42')).toBe(true)
  })

  it('reads from the env var', () => {
    expect(scopeFromEnv({ OSHIELD_GARDENS_SCOPE: 'lab' })).toEqual(parseGardensScope('lab'))
  })
})

describe('backend selection', () => {
  it('picks the first available backend in configured order', async () => {
    const calls: string[] = []
    const dir = mkdtempSync(join(tmpdir(), 'gardens-select-test-'))
    try {
      const imageRef = join(dir, 'seed.iso')
      writeFileSync(imageRef, 'iso')
      const manager = new GardensVmManager({
        env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
        backends: [
          scriptedBackend('qemu', { available: false, calls }),
          scriptedBackend('hyperv', { available: true, calls }),
          scriptedBackend('vz', { available: true, calls })
        ]
      })
      const resolved = await manager.resolveBackend()
      expect(resolved.ok && resolved.backend.id).toBe('hyperv')
      const created = await manager.create({ name: 'eng-7-det', imageRef })
      expect(created.ok).toBe(true)
      expect(calls).toEqual(['create:eng-7-det'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses operations when no backend is available, with reasons', async () => {
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [
        scriptedBackend('qemu', { available: false }),
        scriptedBackend('hyperv', { available: false })
      ]
    })
    const result = await manager.start('eng-7-det')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('no gardens VM backend available')
      expect(result.reason).toContain('qemu')
    }
  })

  it('turns a crashing availability probe into an unavailable verdict, not a crash', async () => {
    const crashingBackend: VmBackend = {
      ...scriptedBackend('qemu', { available: false }),
      available: async () => {
        throw new Error('spawn qemu-system-x86_64 ENOENT')
      }
    }
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [crashingBackend]
    })
    const result = await manager.stop('eng-7-det')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('no gardens VM backend available')
      expect(result.reason).toContain('spawn qemu-system-x86_64 ENOENT')
    }
    const matrix = await manager.backendMatrix()
    expect(matrix[0]?.available).toBe(false)
    expect(matrix[0]?.reason).toContain('ENOENT')
  })
})

describe('scope refusal', () => {
  it('refuses every lifecycle op when the scope env is unset', async () => {
    const calls: string[] = []
    const manager = new GardensVmManager({
      env: {},
      backends: [scriptedBackend('qemu', { available: true, calls })]
    })
    for (const attempt of [
      () => manager.create({ name: 'eng-7-det' }),
      () => manager.start('eng-7-det'),
      () => manager.stop('eng-7-det'),
      () => manager.delete('eng-7-det'),
      () => manager.list()
    ]) {
      const result = await attempt()
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('OSHIELD_GARDENS_SCOPE')
      }
    }
    expect(calls).toEqual([])
  })

  it('lists only names inside the scope prefixes', async () => {
    const calls: string[] = []
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [scriptedBackend('qemu', { available: true, calls })]
    })
    const result = await manager.list()
    expect(result.ok).toBe(true)
    expect(result.ok && result.entries).toEqual([])
  })

  it('refuses names outside the scope prefixes without touching the backend', async () => {
    const calls: string[] = []
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [scriptedBackend('qemu', { available: true, calls })]
    })
    const result = await manager.delete('eng-9-det')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('outside OSHIELD_GARDENS_SCOPE')
    }
    expect(calls).toEqual([])
  })
})

describe('audit records', () => {
  it('attaches an armory-shaped audit event to executed ops', async () => {
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [scriptedBackend('qemu', { available: true })]
    })
    const result: GardensVmOpResult = await manager.start('eng-7-det')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.record.audited).toBe(true)
      expect(result.audit.actorKind).toBe('tentacle')
      expect(result.audit.actorId).toBe('gardens-vm')
      expect(result.audit.action).toBe('gardens.vm.start')
      expect(result.audit.resourceKind).toBe('gardens-vm')
      expect(result.audit.resourceId).toBe('eng-7-det')
      expect(result.audit.traceId).toBeNull()
      expect(result.audit.payload.backend).toBe('qemu')
      expect(gardensVmAuditEvent(result.record).action).toBe(result.audit.action)
    }
  })

  it('audits backend failures as failed records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gardens-fail-test-'))
    try {
      const imageRef = join(dir, 'seed.iso')
      writeFileSync(imageRef, 'iso')
      const manager = new GardensVmManager({
        env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
        backends: [
          scriptedBackend('qemu', { available: true, failCreateWith: 'qemu-img exploded' })
        ]
      })
      const result = await manager.create({ name: 'eng-7-det', imageRef })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toContain('qemu-img exploded')
        expect(result.record?.ok).toBe(false)
        expect(result.audit?.action).toBe('gardens.vm.create')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('manager defaults', () => {
  it('refuses catalog-backed create when the image is not materialized', async () => {
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7', OSHIELD_GARDENS_VM_DIR: 'Z:\\nonexistent-gardens' },
      backends: [scriptedBackend('qemu', { available: true })]
    })
    const result = await manager.create({ name: 'eng-7-det' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('image-download alpine-virt')
    }
  })

  it('reports the backend availability matrix', async () => {
    const manager = new GardensVmManager({
      env: {},
      backends: [scriptedBackend('qemu', { available: true })]
    })
    const matrix = await manager.backendMatrix()
    expect(matrix).toHaveLength(1)
    expect(matrix[0]?.id).toBe('qemu')
  })
})

describe('manager snapshot, rollback, and inspect', () => {
  const snapshotCapableBackend = (options: {
    snapshotResult?: { ok: true; path: string } | { ok: false; reason: string }
    rollbackResult?: { ok: true } | { ok: false; reason: string }
    snapshots?: VmDiskSnapshot[]
    inspectInfo?: VmInspectInfo
  }): VmBackend => ({
    id: 'qemu',
    available: async () => true,
    create: async (spec: VmSpec) => fakeHandle('qemu', spec.name),
    start: async (handle: VmHandle) => ({ ...handle, state: 'running' }),
    stop: async (handle: VmHandle) => ({ ...handle, state: 'stopped' }),
    status: async () => 'stopped',
    delete: async () => {},
    snapshot: async () =>
      options.snapshotResult ?? { ok: true, path: 'C:\\gardens\\eng-7-det.qcow2' },
    rollbackSnapshot: async () => options.rollbackResult ?? { ok: true },
    listSnapshots: async () => ({ ok: true, snapshots: options.snapshots ?? [] }),
    inspect: async () =>
      options.inspectInfo ?? {
        name: 'eng-7-det',
        backend: 'qemu',
        state: 'stopped',
        pidAlive: false,
        snapshots: options.snapshots ?? []
      }
  })

  it('audits a successful snapshot and propagates refusals as failed records', async () => {
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [snapshotCapableBackend({})]
    })
    const ok = await manager.snapshot('eng-7-det', 'base')
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.record.operation).toBe('snapshot')
      expect(ok.record.detail).toContain('snapshot base recorded in')
      expect(ok.audit.action).toBe('gardens.vm.snapshot')
    }
    const refused = await new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [
        snapshotCapableBackend({
          snapshotResult: { ok: false, reason: 'snapshot id already exists' }
        })
      ]
    }).snapshot('eng-7-det', 'base')
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.reason).toBe('snapshot id already exists')
      expect(refused.record?.ok).toBe(false)
      expect(refused.audit?.action).toBe('gardens.vm.snapshot')
    }
  })

  it('refuses rollback while running with the backend reason, and audits it', async () => {
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [
        snapshotCapableBackend({
          rollbackResult: {
            ok: false,
            reason: 'rollback requires a stopped VM; eng-7-det is running (pid 99)'
          }
        })
      ]
    })
    const result = await manager.rollback('eng-7-det', 'base')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toContain('rollback requires a stopped VM')
      expect(result.record?.operation).toBe('rollback')
      expect(result.audit?.action).toBe('gardens.vm.rollback')
    }
  })

  it('refuses snapshot and rollback on backends without the capability', async () => {
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [scriptedBackend('hyperv', { available: true })]
    })
    const snapshotResult = await manager.snapshot('eng-7-det', 'base')
    expect(snapshotResult.ok).toBe(false)
    if (!snapshotResult.ok) {
      expect(snapshotResult.reason).toContain('snapshot unsupported on backend hyperv')
    }
    const rollbackResult = await manager.rollback('eng-7-det', 'base')
    expect(rollbackResult.ok).toBe(false)
    if (!rollbackResult.ok) {
      expect(rollbackResult.reason).toContain('rollback unsupported on backend hyperv')
    }
  })

  it('lists snapshots through the backend', async () => {
    const manager = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [
        snapshotCapableBackend({
          snapshots: [
            { id: '1', name: 'base', vmStateSizeBytes: 0, dateEpochMs: 0 },
            { id: '2', name: 'pre-update', vmStateSizeBytes: 0, dateEpochMs: 0 }
          ]
        })
      ]
    })
    const result = await manager.listSnapshots('eng-7-det')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.snapshots.map((snap) => snap.name)).toEqual(['base', 'pre-update'])
    }
  })

  it('inspect returns the backend info, falling back to plain state without support', async () => {
    const rich = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [
        snapshotCapableBackend({
          inspectInfo: {
            name: 'eng-7-det',
            backend: 'qemu',
            state: 'running',
            pid: 99,
            pidAlive: true,
            uptimeMs: 1_500,
            sshHostPort: 2222,
            snapshots: []
          }
        })
      ]
    })
    const info = await rich.inspect('eng-7-det')
    expect(info.ok).toBe(true)
    if (info.ok) {
      expect(info.info.pid).toBe(99)
      expect(info.info.uptimeMs).toBe(1_500)
    }

    const plain = new GardensVmManager({
      env: { OSHIELD_GARDENS_SCOPE: 'eng-7' },
      backends: [scriptedBackend('qemu', { available: true })]
    })
    const fallback = await plain.inspect('eng-7-det')
    expect(fallback.ok).toBe(true)
    if (fallback.ok) {
      expect(fallback.info.state).toBe('stopped')
      expect(fallback.info.pidAlive).toBe(false)
      expect(fallback.info.snapshots).toEqual([])
    }
    const outOfScope = await plain.inspect('eng-9-det')
    expect(outOfScope.ok).toBe(false)
  })
})
