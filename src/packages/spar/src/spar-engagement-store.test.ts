import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  appendSparExchange,
  createSparEngagement,
  openSparRound,
  transitionSparEngagement,
  type SparEngagement
} from './spar-engagement'
import { scoreSparExchange } from './spar-referee'
import {
  createJsonFileSparEngagementStore,
  createMemorySparEngagementStore,
  defaultSparStorePath,
  SPAR_STORE_FORMAT_VERSION
} from './spar-engagement-store'

const NOW = 1_700_000_000_000

const sampleEngagement = (): SparEngagement =>
  appendSparExchange(
    openSparRound(
      transitionSparEngagement(
        createSparEngagement(
          { name: 'nightly war', gardenVmName: 'garden-twin-01', adversarySource: 'mythic', intensity: 'nightly' },
          { id: 'spar-eng-5', nowEpochMs: () => NOW }
        ),
        'start'
      ),
      { id: 'spar-eng-5-r1', startedAtEpochMs: NOW }
    ),
    'spar-eng-5-r1',
    { ...scoreSparExchange({ techniqueId: 'T1059', defenseResult: 'missed' }), scoredAtEpochMs: NOW + 1 }
  )

describe('createMemorySparEngagementStore', () => {
  it('round-trips engagements in memory', () => {
    const store = createMemorySparEngagementStore()
    expect(store.load()).toEqual([])
    store.save([sampleEngagement()])
    expect(store.load()).toHaveLength(1)
    expect(store.load()[0]?.id).toBe('spar-eng-5')
  })
})

describe('createJsonFileSparEngagementStore', () => {
  it('writes a versioned store and reloads it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spar-store-test-'))
    try {
      const filePath = join(dir, 'nested', 'engagements.json')
      const store = createJsonFileSparEngagementStore(filePath)
      expect(store.load()).toEqual([])
      store.save([sampleEngagement()])
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as { version: number; engagements: unknown[] }
      expect(raw.version).toBe(SPAR_STORE_FORMAT_VERSION)
      expect(store.load()).toEqual([sampleEngagement()])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed on tampered scoring and malformed files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'spar-store-test-'))
    try {
      const filePath = join(dir, 'engagements.json')
      const store = createJsonFileSparEngagementStore(filePath)
      store.save([sampleEngagement()])
      const raw = JSON.parse(readFileSync(filePath, 'utf8')) as {
        version: number
        engagements: { rounds: { techniques: Record<string, unknown>[] }[] }[]
      }
      raw.engagements[0]!.rounds[0]!.techniques[0]!.pointsAdversary = 99
      writeFileSync(filePath, JSON.stringify(raw))
      expect(() => store.load()).toThrow(/scoring table/)

      writeFileSync(filePath, '{"version": 99, "engagements": []}')
      expect(() => store.load()).toThrow(/not a version/)
      writeFileSync(filePath, 'not json')
      expect(() => store.load()).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('defaultSparStorePath', () => {
  it('prefers OSHIELD_SPAR_STORE and falls back under the temp dir', () => {
    expect(defaultSparStorePath({ OSHIELD_SPAR_STORE: 'D:\\spar\\store.json' })).toBe('D:\\spar\\store.json')
    expect(defaultSparStorePath({})).toContain(join(tmpdir(), 'oshield-spar', 'engagements.json'))
  })
})
