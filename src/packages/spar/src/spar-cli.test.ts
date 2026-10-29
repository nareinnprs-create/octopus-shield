import { describe, expect, it } from 'vitest'

import {
  createMemorySparEngagementStore,
  type SparEngagementStore
} from './spar-engagement-store'
import type { SparAuditRecord, SparAuditSink } from './spar-runner'
import { runSparCli, SPAR_CLI_USAGE } from './spar-cli'
import type { SparEventSink, SparEventType } from './spar-events'

type Captured = { events: { type: SparEventType; payload: unknown }[]; audits: SparAuditRecord[] }

type CliFixture = {
  store: SparEngagementStore
  out: string[]
  err: string[]
  captured: Captured
}

const cliFixture = (): { fixture: CliFixture; run: (argv: string[]) => number } => {
  const out: string[] = []
  const err: string[] = []
  const captured: Captured = { events: [], audits: [] }
  const store = createMemorySparEngagementStore()
  const fixture: CliFixture = { store, out, err, captured }
  const events: SparEventSink = {
    publish: (type, payload) => captured.events.push({ type, payload: payload as unknown })
  }
  const audits: SparAuditSink = { append: (record) => captured.audits.push(record) }
  let tick = 0
  const nowEpochMs = () => 1_700_000_000_000 + (tick += 1)
  const run = (argv: string[]): number =>
    runSparCli({ argv, store, events, audits, nowEpochMs, out: (line) => out.push(line), err: (line) => err.push(line) })
  return { fixture, run }
}

const ENGAGEMENT_ARGS = [
  'create',
  'nightly war',
  '--garden',
  'garden-twin-01',
  '--source',
  'mythic',
  '--intensity',
  'nightly'
]

describe('runSparCli — the full phase-1 loop', () => {
  it('creates, runs rounds, scores exchanges, concludes, and reports', () => {
    const { fixture, run } = cliFixture()
    const { out, err, captured } = fixture

    expect(run(ENGAGEMENT_ARGS)).toBe(0)
    const id = out.at(-1)?.match(/engagement (spar-eng-\d+)/)?.[1]
    expect(id).toMatch(/^spar-eng-\d+$/)
    expect(id).toBe('spar-eng-1700000000001')
    expect(captured.events[0]?.type).toBe('spar.engagement.created')
    expect(captured.audits[0]?.action).toBe('spar.engagement.created')
    expect(captured.audits[0]?.resourceKind).toBe('spar-engagement')

    expect(run(['start', id!])).toBe(0)
    expect(out.at(-1)).toBe(`spar: engagement ${id} running`)
    expect(captured.events.at(-1)?.type).toBe('spar.engagement.started')

    expect(run(['round-start', id!])).toBe(0)
    expect(out.at(-1)).toBe(`spar: round ${id}-r1 started in ${id}`)
    expect(captured.events.at(-1)?.type).toBe('spar.round.started')

    expect(run(['exchange', `${id}-r1`, 'T1059', 'missed'])).toBe(0)
    expect(out.at(-1)).toContain('T1059 missed -> breach adversary=3 defense=0')
    expect(run(['exchange', `${id}-r1`, 'T1114.002', 'detected'])).toBe(0)
    expect(out.at(-1)).toContain('T1114.002 detected -> defended adversary=0 defense=2')
    expect(run(['exchange', `${id}-r1`, 'T1027', 'contained'])).toBe(0)
    expect(out.at(-1)).toContain('T1027 contained -> contained-breach adversary=1 defense=1')
    expect(run(['exchange', `${id}-r1`, 'T1059', 'evaded'])).toBe(0)
    expect(out.at(-1)).toContain('T1059 evaded -> breach adversary=3 defense=0')
    expect(captured.events.filter((event) => event.type === 'spar.exchange.scored')).toHaveLength(4)

    expect(run(['round-conclude', `${id}-r1`])).toBe(0)
    expect(captured.events.at(-1)?.type).toBe('spar.round.concluded')

    expect(run(['conclude', id!])).toBe(0)
    expect(out.at(-1)).toContain(`engagement ${id} concluded rounds=1 exchanges=4 adversary=7 defense=3`)
    expect(captured.events.at(-1)?.type).toBe('spar.engagement.concluded')

    expect(run(['status', id!])).toBe(0)
    expect(out.join('\n')).toContain(`status: concluded`)
    expect(out.join('\n')).toContain(`${id}-r1  concluded@`)

    expect(run(['scoreboard', id!])).toBe(0)
    const board = out.join('\n')
    expect(board).toContain('exchanges=4 adversary=7 defense=3 detectionRate=50% (sensor fired 2/4)')
    expect(board).toContain('T1027 attempts=1 detected=0 contained=1 missed=0 evaded=0 defended=0 breaches=0 contained-breach=1 adv=1 def=1 rate=100%')
    expect(board).toContain('T1059 attempts=2 detected=0 contained=0 missed=1 evaded=1 defended=0 breaches=2 contained-breach=0 adv=6 def=0 rate=0%')
    expect(board).toContain('T1114.002 attempts=1 detected=1 contained=0 missed=0 evaded=0 defended=1 breaches=0 contained-breach=0 adv=0 def=2 rate=100%')
    expect(board).toContain('weakest: T1059 (0%), T1027 (100%), T1114.002 (100%)')

    expect(err).toEqual([])
    // Store round-trips through separate invocations (shared fake store).
    expect(fixture.store.load()[0]?.status).toBe('concluded')
  })

  it('resumes a paused engagement via start', () => {
    const { fixture, run } = cliFixture()
    const { out, captured } = fixture
    expect(run(ENGAGEMENT_ARGS)).toBe(0)
    const id = out.at(-1)?.match(/engagement (spar-eng-\d+)/)?.[1]
    expect(run(['start', id!])).toBe(0)
    expect(run(['pause', id!])).toBe(0)
    expect(out.at(-1)).toBe(`spar: engagement ${id} paused`)
    expect(run(['start', id!])).toBe(0)
    expect(out.at(-1)).toBe(`spar: engagement ${id} running (resumed)`)
    expect(captured.audits.at(-1)?.payload).toEqual({ resumed: true })
  })
})

describe('runSparCli — denials (exit 3) and usage (exit 2)', () => {
  it('denies unknown engagement, unknown round, and illegal transitions', () => {
    const { fixture, run } = cliFixture()
    const { err } = fixture
    expect(run(['start', 'spar-eng-ghost'])).toBe(3)
    expect(err.at(-1)).toContain('unknown engagement')

    expect(run(ENGAGEMENT_ARGS)).toBe(0)
    const id = fixture.out.at(-1)?.match(/engagement (spar-eng-\d+)/)?.[1]

    expect(run(['conclude', id!])).toBe(3)
    expect(err.at(-1)).toContain('planned')

    expect(run(['round-start', id!])).toBe(3)
    expect(err.at(-1)).toContain('running')

    expect(run(['exchange', 'ghost-r1', 'T1059', 'missed'])).toBe(3)
    expect(err.at(-1)).toContain('unknown round')
  })

  it('denies concluding with an open round and bad exchange verdicts', () => {
    const { fixture, run } = cliFixture()
    const { err } = fixture
    expect(run(ENGAGEMENT_ARGS)).toBe(0)
    const id = fixture.out.at(-1)?.match(/engagement (spar-eng-\d+)/)?.[1]
    expect(run(['start', id!])).toBe(0)
    expect(run(['round-start', id!])).toBe(0)

    expect(run(['conclude', id!])).toBe(3)
    expect(err.at(-1)).toContain('open')

    expect(run(['exchange', `${id}-r1`, 'T1059', 'wobbled'])).toBe(2)
    expect(err.at(-1)).toContain('result must be one of')
  })

  it('prints usage and exits 2 on unknown verbs and malformed args', () => {
    const { fixture, run } = cliFixture()
    const { err } = fixture
    expect(run(['frobnicate'])).toBe(2)
    expect(err.at(-1)).toBe(SPAR_CLI_USAGE)
    expect(run(['create', 'no-flags'])).toBe(2)
    expect(err.at(-1)).toContain('--garden')
    expect(run(['create', 'x', '--garden', 'vm', '--source', 'metasploit', '--intensity', 'nightly'])).toBe(2)
    expect(err.at(-1)).toContain('--source must be')
    expect(run(['status'])).toBe(2)
  })

  it('fails closed with exit 3 when the store is corrupt', () => {
    const out: string[] = []
    const err: string[] = []
    const corrupt = createMemorySparEngagementStore()
    corrupt.save = () => {
      throw new RangeError('disk full')
    }
    const code = runSparCli({
      argv: ENGAGEMENT_ARGS,
      store: corrupt,
      events: { publish: () => {} },
      audits: { append: () => {} },
      out: (line) => out.push(line),
      err: (line) => err.push(line)
    })
    expect(code).toBe(3)
    expect(err.at(-1)).toContain('store save failed')
    expect(err.at(-1)).toContain('disk full')
  })
})
