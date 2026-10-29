import { describe, expect, it } from 'vitest'

import {
  createSparEngagement,
  openSparRound,
  transitionSparEngagement,
  type SparEngagement
} from './spar-engagement'
import type { SparAuditRecord, SparAuditSink } from './spar-runner'
import { createSparRunner } from './spar-runner'
import type { SparEvent, SparEventMap, SparEventSink, SparEventType } from './spar-events'

const NOW = 1_700_000_000_000

type CapturedEvents = { events: { type: SparEventType; payload: unknown }[]; audits: SparAuditRecord[] }

const fakeSinks = (): { sinks: { events: SparEventSink; audits: SparAuditSink }; captured: CapturedEvents } => {
  const captured: CapturedEvents = { events: [], audits: [] }
  return {
    captured,
    sinks: {
      events: {
        publish: (type, payload) => {
          captured.events.push({ type, payload: payload as unknown })
        }
      },
      audits: {
        append: (record) => {
          captured.audits.push(record)
        }
      }
    }
  }
}

const runningEngagement = (): SparEngagement =>
  transitionSparEngagement(
    createSparEngagement(
      { name: 'nightly war', gardenVmName: 'garden-twin-01', adversarySource: 'mythic', intensity: 'nightly' },
      { id: 'spar-eng-7', nowEpochMs: () => NOW }
    ),
    'start'
  )

const runnerWithRound = (
  sinks: ReturnType<typeof fakeSinks>['sinks']
): { engagement: SparEngagement; runner: ReturnType<typeof createSparRunner> } => {
  const engagement = openSparRound(runningEngagement(), { id: 'spar-eng-7-r1', startedAtEpochMs: NOW })
  let tick = 0
  const runner = createSparRunner({ ...sinks, nowEpochMs: () => NOW + (tick += 1) })
  return { engagement, runner }
}

describe('createSparRunner — emissions per transition', () => {
  it('startRound appends an open round and emits round.started audit + event', () => {
    const { sinks, captured } = fakeSinks()
    const engagement = runningEngagement()
    const runner = createSparRunner({ ...sinks, nowEpochMs: () => NOW + 50 })
    const result = runner.startRound(engagement)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('unreachable')
    }
    expect(result.engagement.rounds).toEqual([
      { id: 'spar-eng-7-r1', startedAtEpochMs: NOW + 50, techniques: [] }
    ])
    expect(engagement.rounds).toEqual([])
    expect(captured.events).toEqual([
      {
        type: 'spar.round.started',
        payload: { engagementId: 'spar-eng-7', roundId: 'spar-eng-7-r1', startedAtEpochMs: NOW + 50 }
      }
    ])
    expect(captured.audits).toEqual([
      {
        tsEpochMs: NOW + 50,
        actorKind: 'tentacle',
        actorId: 'spar',
        action: 'spar.round.started',
        resourceKind: 'spar-round',
        resourceId: 'spar-eng-7-r1',
        traceId: null,
        payload: { engagementId: 'spar-eng-7', startedAtEpochMs: NOW + 50 }
      }
    ])
  })

  it('submitExchange scores via the referee, appends, and emits exchange.scored', () => {
    const { sinks, captured } = fakeSinks()
    const { engagement, runner } = runnerWithRound(sinks)
    const result = runner.submitExchange(engagement, 'spar-eng-7-r1', {
      techniqueId: 'T1114.002',
      defenseResult: 'contained'
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('unreachable')
    }
    expect(result.value.exchange).toEqual({
      techniqueId: 'T1114.002',
      defenseResult: 'contained',
      outcome: 'contained-breach',
      pointsAdversary: 1,
      pointsDefense: 1,
      scoredAtEpochMs: NOW + 1
    })
    expect(result.engagement.rounds[0]?.techniques).toHaveLength(1)
    expect(captured.events).toEqual([
      {
        type: 'spar.exchange.scored',
        payload: {
          engagementId: 'spar-eng-7',
          roundId: 'spar-eng-7-r1',
          techniqueId: 'T1114.002',
          defenseResult: 'contained',
          outcome: 'contained-breach',
          pointsAdversary: 1,
          pointsDefense: 1
        }
      }
    ])
    expect(captured.audits[0]?.action).toBe('spar.exchange.scored')
    expect(captured.audits[0]?.resourceId).toBe('spar-eng-7-r1')
  })

  it('concludeRound stamps the round and emits the scoreboard in round.concluded', () => {
    const { sinks, captured } = fakeSinks()
    const { engagement, runner } = runnerWithRound(sinks)
    const withExchange = runner.submitExchange(engagement, 'spar-eng-7-r1', {
      techniqueId: 'T1059',
      defenseResult: 'detected'
    })
    if (!withExchange.ok) {
      throw new Error('unreachable')
    }
    captured.events.length = 0
    captured.audits.length = 0
    const result = runner.concludeRound(withExchange.engagement, 'spar-eng-7-r1')

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error('unreachable')
    }
    expect(result.value.round.concludedAtEpochMs).toBe(NOW + 3)
    expect(captured.events).toEqual([
      {
        type: 'spar.round.concluded',
        payload: {
          engagementId: 'spar-eng-7',
          roundId: 'spar-eng-7-r1',
          concludedAtEpochMs: NOW + 3,
          exchanges: 1,
          pointsAdversary: 0,
          pointsDefense: 2
        }
      }
    ])
    expect(captured.audits[0]?.action).toBe('spar.round.concluded')
    expect(captured.audits[0]?.payload).toEqual({
      engagementId: 'spar-eng-7',
      concludedAtEpochMs: NOW + 3,
      exchanges: 1,
      pointsAdversary: 0,
      pointsDefense: 2
    })
  })
})

describe('createSparRunner — denials emit nothing', () => {
  const denialCases = {
    'planned engagement': (): SparEngagement =>
      createSparEngagement(
        { name: 'x', gardenVmName: 'vm', adversarySource: 'caldera', intensity: 'weekly' },
        { id: 'spar-eng-8', nowEpochMs: () => NOW }
      ),
    'paused engagement': (): SparEngagement =>
      transitionSparEngagement(
        openSparRound(runningEngagement(), { id: 'spar-eng-7-r1', startedAtEpochMs: NOW }),
        'pause'
      ),
    'concluded engagement': (): SparEngagement =>
      transitionSparEngagement(runningEngagement(), 'conclude')
  }

  for (const [label, make] of Object.entries(denialCases)) {
    it(`denies all three ops on a ${label} without emitting`, () => {
      const { sinks, captured } = fakeSinks()
      const runner = createSparRunner({ ...sinks, nowEpochMs: () => NOW })
      const engagement = make()
      const started = runner.startRound(engagement)
      const scored = runner.submitExchange(engagement, 'spar-eng-7-r1', {
        techniqueId: 'T1059',
        defenseResult: 'missed'
      })
      const concluded = runner.concludeRound(engagement, 'spar-eng-7-r1')
      for (const result of [started, scored, concluded]) {
        expect(result.ok).toBe(false)
      }
      expect(captured.events).toEqual([])
      expect(captured.audits).toEqual([])
    })
  }

  it('denies unknown and double-concluded rounds without emitting', () => {
    const { sinks, captured } = fakeSinks()
    const { engagement, runner } = runnerWithRound(sinks)
    expect(runner.submitExchange(engagement, 'nope', { techniqueId: 'T1059', defenseResult: 'missed' })).toEqual({
      ok: false,
      reason: 'unknown round: nope'
    })
    const first = runner.concludeRound(engagement, 'spar-eng-7-r1')
    expect(first.ok).toBe(true)
    captured.events.length = 0
    captured.audits.length = 0
    if (!first.ok) {
      throw new Error('unreachable')
    }
    const second = runner.concludeRound(first.engagement, 'spar-eng-7-r1')
    expect(second.ok).toBe(false)
    expect(second).toMatchObject({ reason: /already concluded/ })
    expect(captured.events).toEqual([])
    expect(captured.audits).toEqual([])
  })

  it('surfaces invalid technique ids as denials, not throws', () => {
    const { sinks, captured } = fakeSinks()
    const { engagement, runner } = runnerWithRound(sinks)
    const result = runner.submitExchange(engagement, 'spar-eng-7-r1', {
      techniqueId: 'bogus',
      defenseResult: 'missed'
    })
    expect(result.ok).toBe(false)
    expect(captured.events).toEqual([])
    expect(captured.audits).toEqual([])
  })

  it('rethrows non-RangeError failures from the pure layer', () => {
    const { sinks } = fakeSinks()
    const runner = createSparRunner({ ...sinks, nowEpochMs: () => NOW })
    const engagement = runningEngagement()
    // SAFETY: test hook — force a non-RangeError (TypeError) inside the pure layer.
    Object.defineProperty(engagement, 'rounds', {
      get: (): never => {
        throw new TypeError('boom')
      }
    })
    expect(() => runner.startRound(engagement)).toThrow(TypeError)
  })
})

describe('SparEventSink typing sanity', () => {
  it('SparEventMap payloads line up with SparEvent', () => {
    const event: SparEvent<'spar.exchange.scored'> = {
      type: 'spar.exchange.scored',
      payload: {
        engagementId: 'e',
        roundId: 'r',
        techniqueId: 'T1059',
        defenseResult: 'missed',
        outcome: 'breach',
        pointsAdversary: 3,
        pointsDefense: 0
      },
      occurredAtEpochMs: NOW
    }
    const map: SparEventMap[typeof event.type] = event.payload
    expect(map.pointsAdversary).toBe(3)
  })
})
