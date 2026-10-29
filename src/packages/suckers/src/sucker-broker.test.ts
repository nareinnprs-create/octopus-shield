import { describe, expect, it } from 'vitest'

import type { AuditEvent } from '@shield/access/audit-chain'

import {
  SuckerBroker,
  type SuckerBrokerOptions,
  type SuckerProcessLike,
  type SuckerProcessRequest
} from './sucker-broker'

const manifest = {
  id: 'threat-intel-generic',
  version: '0.1.0',
  kind: 'threat-intel',
  permissions: [{ resourceKind: 'ioc-record', action: 'query' }],
  isolation: { tier: 'shed-isolated' },
  egress: [{ capability: 'external.ioc-reputation', purpose: 'reputation lookups' }],
  publisher: { id: 'example-publisher', signingKeyId: 'key-123' }
}

function recordingSpawn(
  respond: () => Partial<{
    exitCode: number | null
    stdout: string
    stderr: string
    timedOut: boolean
  }> = () => ({})
): { spawn: SuckerProcessLike; calls: SuckerProcessRequest[] } {
  const calls: SuckerProcessRequest[] = []
  const spawn: SuckerProcessLike = async (request) => {
    calls.push(request)
    return { exitCode: 0, timedOut: false, durationMs: 4, stdout: 'ok', stderr: '', ...respond() }
  }
  return { spawn, calls }
}

function auditCollector(): {
  options: Pick<SuckerBrokerOptions, 'onAuditEvent'>
  events: AuditEvent[]
} {
  const events: AuditEvent[] = []
  return { options: { onAuditEvent: (event) => events.push(event) }, events }
}

/** install + grant-all with per-test fakes; throws on lifecycle refusal. */
async function grantedBroker(options: SuckerBrokerOptions): Promise<{ broker: SuckerBroker }> {
  const broker = new SuckerBroker(options)
  const installed = await broker.install(manifest)
  if (!installed.ok) {
    throw new Error(installed.reason)
  }
  const granted = await broker.grant(manifest.id)
  if (!granted.ok) {
    throw new Error(granted.reason)
  }
  return { broker }
}

describe('SuckerBroker lifecycle', () => {
  it('runs grant → invoke → revoke with captured output', async () => {
    const fake = recordingSpawn()
    const { broker } = await grantedBroker({ spawn: fake.spawn })
    const result = await broker.invoke(manifest.id, 'external.ioc-reputation', ['8.8.8.8'])
    expect(result.outcome).toBe('satisfied')
    if (result.outcome === 'satisfied') {
      expect(result.process.stdout).toBe('ok')
      expect(result.process.exitCode).toBe(0)
    }
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]).toEqual({
      suckerId: manifest.id,
      capability: 'external.ioc-reputation',
      args: ['8.8.8.8'],
      timeoutMs: 120_000
    })
    const revoked = await broker.revoke(manifest.id)
    expect(revoked.ok).toBe(true)
    const after = await broker.invoke(manifest.id, 'external.ioc-reputation', ['8.8.8.8'])
    expect(after).toMatchObject({ outcome: 'permissionDenied', because: 'no-grant' })
    expect(fake.calls).toHaveLength(1)
  })

  it('denies by default: invoke before any grant is refused before spawn', async () => {
    const fake = recordingSpawn()
    const broker = new SuckerBroker({ spawn: fake.spawn })
    const installed = await broker.install(manifest)
    expect(installed.ok).toBe(true)
    const result = await broker.invoke(manifest.id, 'external.ioc-reputation')
    expect(result).toMatchObject({ outcome: 'permissionDenied', because: 'no-grant' })
    expect(fake.calls).toHaveLength(0)
  })

  it('denies unknown suckers without spawning', async () => {
    const fake = recordingSpawn()
    const broker = new SuckerBroker({ spawn: fake.spawn })
    const result = await broker.invoke('never-installed', 'external.ioc-reputation')
    expect(result).toMatchObject({ outcome: 'permissionDenied', because: 'no-grant' })
    expect(fake.calls).toHaveLength(0)
  })

  it('maps an operator deny row to explicit-deny', async () => {
    const fake = recordingSpawn()
    const broker = new SuckerBroker({ spawn: fake.spawn })
    await broker.install(manifest)
    const granted = await broker.grant(manifest.id, {
      capabilities: [{ capability: 'external.ioc-reputation', effect: 'deny' }]
    })
    expect(granted.ok).toBe(true)
    const result = await broker.invoke(manifest.id, 'external.ioc-reputation')
    expect(result).toMatchObject({ outcome: 'permissionDenied', because: 'explicit-deny' })
    expect(fake.calls).toHaveLength(0)
  })

  it('refuses grants after revoke and denies the next invoke', async () => {
    const fake = recordingSpawn()
    const { broker } = await grantedBroker({ spawn: fake.spawn })
    const revoked = await broker.revoke(manifest.id)
    expect(revoked.ok).toBe(true)
    const regrant = await broker.grant(manifest.id)
    expect(regrant.ok).toBe(false)
    const result = await broker.invoke(manifest.id, 'external.ioc-reputation')
    expect(result.outcome).toBe('permissionDenied')
    expect(fake.calls).toHaveLength(0)
  })

  it('refuses grants that widen authority beyond the request', async () => {
    const fake = recordingSpawn()
    const broker = new SuckerBroker({ spawn: fake.spawn })
    await broker.install(manifest)
    expect(
      (
        await broker.grant(manifest.id, {
          permissions: [{ resourceKind: 'sessions', action: 'read' }]
        })
      ).ok
    ).toBe(false)
    expect((await broker.grant(manifest.id, { capabilities: ['external.host-noise'] })).ok).toBe(
      false
    )
    const result = await broker.invoke(manifest.id, 'external.ioc-reputation')
    expect(result.outcome).toBe('permissionDenied')
    expect(fake.calls).toHaveLength(0)
  })

  it('rejects duplicate installs and revoked-id reuse', async () => {
    const broker = new SuckerBroker({ spawn: recordingSpawn().spawn })
    expect((await broker.install(manifest)).ok).toBe(true)
    expect((await broker.install(manifest)).ok).toBe(false)
    await broker.revoke(manifest.id)
    expect((await broker.install(manifest)).ok).toBe(false)
  })

  it('throws on malformed caller input before any authority decision', async () => {
    const fake = recordingSpawn()
    const { broker } = await grantedBroker({ spawn: fake.spawn })
    await expect(broker.invoke(manifest.id, '')).rejects.toBeInstanceOf(RangeError)
    await expect(
      broker.invoke(manifest.id, 'external.ioc-reputation', ['ok', 42 as unknown as string])
    ).rejects.toBeInstanceOf(RangeError)
    expect(fake.calls).toHaveLength(0)
  })

  it('maps spawn throw to non-retryable and timeout to retryable upstream-failure', async () => {
    const throwing = new SuckerBroker({
      spawn: async () => {
        throw new Error('spawn failed')
      }
    })
    await throwing.install(manifest)
    await throwing.grant(manifest.id)
    expect(await throwing.invoke(manifest.id, 'external.ioc-reputation')).toMatchObject({
      outcome: 'upstream-failure',
      retryable: false
    })

    const { broker } = await grantedBroker({
      spawn: async () => ({
        exitCode: null,
        timedOut: true,
        durationMs: 120_000,
        stdout: '',
        stderr: ''
      })
    })
    expect(await broker.invoke(manifest.id, 'external.ioc-reputation')).toMatchObject({
      outcome: 'upstream-failure',
      retryable: true
    })
  })

  it('maps empty output to the contract empty outcome', async () => {
    const { broker } = await grantedBroker({
      spawn: async () => ({ exitCode: 0, timedOut: false, durationMs: 1, stdout: '', stderr: '' })
    })
    const result = await broker.invoke(manifest.id, 'external.ioc-reputation')
    expect(result.outcome).toBe('empty')
  })

  it('denies capabilities outside the declared egress even with grants present', async () => {
    const fake = recordingSpawn()
    const { broker } = await grantedBroker({ spawn: fake.spawn })
    const result = await broker.invoke(manifest.id, 'external.host-noise')
    expect(result).toMatchObject({ outcome: 'permissionDenied', because: 'no-grant' })
    expect(fake.calls).toHaveLength(0)
  })

  it('rehydrates from snapshot() with grants intact and drops malformed grant rows', async () => {
    const { broker } = await grantedBroker({ spawn: recordingSpawn().spawn })
    const persisted = broker.snapshot()
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.status).toBe('granted')
    expect(persisted[0]?.grants).toHaveLength(2)

    const rehydrated = new SuckerBroker({ spawn: recordingSpawn().spawn })
    for (const record of persisted) {
      rehydrated.restore(record)
    }
    expect((await rehydrated.invoke(manifest.id, 'external.ioc-reputation')).outcome).toBe(
      'satisfied'
    )

    const withRot = new SuckerBroker({ spawn: recordingSpawn().spawn })
    withRot.restore({
      manifest: persisted[0]!.manifest,
      status: 'granted',
      grants: [
        { resourceKind: 'sucker.capability', action: 'external.ioc-reputation', effect: 'allow' },
        { resourceKind: '', action: 'x', effect: 'allow' },
        { resourceKind: 'sucker.capability', action: 'y', effect: 'escalate' }
      ] as never
    })
    expect((await withRot.invoke(manifest.id, 'external.ioc-reputation')).outcome).toBe('satisfied')
    expect((await withRot.invoke(manifest.id, 'y')).outcome).toBe('permissionDenied')
  })

  it('never lets restore overwrite live in-memory state', async () => {
    const { broker } = await grantedBroker({ spawn: recordingSpawn().spawn })
    const stale = broker.snapshot()[0]
    if (stale === undefined) {
      throw new Error('expected a snapshot')
    }
    await broker.revoke(manifest.id)
    broker.restore({ ...stale, status: 'granted' })
    expect((await broker.invoke(manifest.id, 'external.ioc-reputation')).outcome).toBe(
      'permissionDenied'
    )
  })
})

describe('SuckerBroker audit trail', () => {
  it('emits an actor_kind=sucker event per lifecycle transition and invoke', async () => {
    const audit = auditCollector()
    const broker = new SuckerBroker({ spawn: recordingSpawn().spawn, ...audit.options })
    await broker.install(manifest)
    await broker.grant(manifest.id)
    await broker.invoke(manifest.id, 'external.ioc-reputation', ['1.1.1.1'])
    await broker.invoke(manifest.id, 'undeclared.capability')
    await broker.revoke(manifest.id)
    expect(audit.events.map((event) => event.action)).toEqual([
      'sucker.install',
      'sucker.grant',
      'sucker.invoke',
      'sucker.invoke',
      'sucker.revoke'
    ])
    expect(audit.events.every((event) => event.actorKind === 'sucker')).toBe(true)
    expect(audit.events.every((event) => event.actorId === manifest.id)).toBe(true)
  })

  it('records deny outcomes without leaking raw args into the payload', async () => {
    const audit = auditCollector()
    const broker = new SuckerBroker({ spawn: recordingSpawn().spawn, ...audit.options })
    await broker.install(manifest)
    await broker.invoke(manifest.id, 'external.ioc-reputation', ['secret-ioc-value'])
    expect(audit.events).toHaveLength(2)
    expect(audit.events[1]?.payload).toMatchObject({
      outcome: 'permissionDenied',
      because: 'no-grant'
    })
    expect(JSON.stringify(audit.events[1]?.payload)).not.toContain('secret-ioc-value')
  })

  it('lists suckers with status and grant counts', async () => {
    const { broker } = await grantedBroker({ spawn: recordingSpawn().spawn })
    expect(broker.list()).toEqual([
      {
        id: manifest.id,
        version: '0.1.0',
        kind: 'threat-intel',
        tier: 'shed-isolated',
        status: 'granted',
        publisherId: 'example-publisher',
        grantCount: 2,
        requestedCount: 1,
        declaredCapabilities: ['external.ioc-reputation']
      }
    ])
  })
})
