import { describe, expect, it } from 'vitest'

import {
  createSparEngagement,
  appendSparExchange,
  concludeSparRound,
  isAttackTechniqueId,
  openSparRound,
  parseAttackTechniqueId,
  sparTransition,
  transitionSparEngagement,
  validateSparEngagement,
  validateSparRound,
  type SparDefenseResult,
  type SparEngagement
} from './spar-engagement'
import { scoreSparExchange } from './spar-referee'

const NOW = 1_700_000_000_000

const makeExchange = (techniqueId = 'T1059', defenseResult: SparDefenseResult = 'detected') => ({
  ...scoreSparExchange({ techniqueId, defenseResult }),
  scoredAtEpochMs: NOW + 1
})

const plannedEngagement = (): SparEngagement =>
  createSparEngagement(
    { name: 'weekly skirmish', gardenVmName: 'garden-twin-01', adversarySource: 'caldera', intensity: 'weekly' },
    { id: 'spar-eng-1', nowEpochMs: () => NOW }
  )

const runningWithOpenRound = (): SparEngagement =>
  openSparRound(transitionSparEngagement(plannedEngagement(), 'start'), {
    id: 'spar-eng-1-r1',
    startedAtEpochMs: NOW
  })

describe('createSparEngagement', () => {
  it('creates a planned engagement with empty rounds', () => {
    const engagement = plannedEngagement()
    expect(engagement.status).toBe('planned')
    expect(engagement.rounds).toEqual([])
    expect(engagement.id).toBe('spar-eng-1')
    expect(engagement.name).toBe('weekly skirmish')
    expect(engagement.gardenVmName).toBe('garden-twin-01')
    expect(engagement.adversarySource).toBe('caldera')
    expect(engagement.intensity).toBe('weekly')
  })

  it('defaults the id from the injected clock', () => {
    const engagement = createSparEngagement({
      name: 'x',
      gardenVmName: 'vm',
      adversarySource: 'mythic',
      intensity: 'always-on'
    })
    expect(engagement.id).toBe(`spar-eng-${Date.now()}`)
    expect(engagement.adversarySource).toBe('mythic')
    expect(engagement.intensity).toBe('always-on')
  })

  it('rejects empty names, empty VM names, unknown sources, unknown intensities', () => {
    for (const input of [
      { name: '', gardenVmName: 'vm', adversarySource: 'caldera' as const, intensity: 'weekly' as const },
      { name: '   ', gardenVmName: 'vm', adversarySource: 'caldera' as const, intensity: 'weekly' as const },
      { name: 'x', gardenVmName: '', adversarySource: 'caldera' as const, intensity: 'weekly' as const },
      { name: 'x', gardenVmName: 'vm', adversarySource: 'metasploit' as never, intensity: 'weekly' as const },
      { name: 'x', gardenVmName: 'vm', adversarySource: 'caldera' as const, intensity: 'hourly' as never }
    ]) {
      expect(() => createSparEngagement(input)).toThrow(RangeError)
    }
  })
})

describe('state machine — legal transitions', () => {
  it('walks planned -> running -> paused -> running -> concluded', () => {
    let engagement = plannedEngagement()
    engagement = transitionSparEngagement(engagement, 'start')
    expect(engagement.status).toBe('running')
    engagement = transitionSparEngagement(engagement, 'pause')
    expect(engagement.status).toBe('paused')
    engagement = transitionSparEngagement(engagement, 'start')
    expect(engagement.status).toBe('running')
    engagement = transitionSparEngagement(engagement, 'conclude')
    expect(engagement.status).toBe('concluded')
  })

  it('sparTransition returns null for illegal moves', () => {
    expect(sparTransition('planned', 'pause')).toBeNull()
    expect(sparTransition('planned', 'conclude')).toBeNull()
    expect(sparTransition('paused', 'pause')).toBeNull()
    expect(sparTransition('paused', 'conclude')).toBeNull()
    expect(sparTransition('concluded', 'start')).toBeNull()
    expect(sparTransition('concluded', 'pause')).toBeNull()
    expect(sparTransition('concluded', 'conclude')).toBeNull()
    expect(sparTransition('running', 'start')).toBeNull()
  })

  it('throws on every illegal skip', () => {
    const planned = plannedEngagement()
    expect(() => transitionSparEngagement(planned, 'pause')).toThrow(RangeError)
    expect(() => transitionSparEngagement(planned, 'conclude')).toThrow(RangeError)
    const running = transitionSparEngagement(planned, 'start')
    expect(() => transitionSparEngagement(running, 'start')).toThrow(RangeError)
    const paused = transitionSparEngagement(running, 'pause')
    expect(() => transitionSparEngagement(paused, 'conclude')).toThrow(RangeError)
    expect(() => transitionSparEngagement(paused, 'pause')).toThrow(RangeError)
    const concluded = transitionSparEngagement(running, 'conclude')
    for (const action of ['start', 'pause', 'conclude'] as const) {
      expect(() => transitionSparEngagement(concluded, action)).toThrow(RangeError)
    }
  })

  it('refuses to conclude while a round is open', () => {
    const engagement = runningWithOpenRound()
    expect(() => transitionSparEngagement(engagement, 'conclude')).toThrow(/spar-eng-1-r1/)
  })

  it('returns a new object and leaves the input untouched', () => {
    const engagement = plannedEngagement()
    const next = transitionSparEngagement(engagement, 'start')
    expect(engagement.status).toBe('planned')
    expect(next).not.toBe(engagement)
    expect(next.status).toBe('running')
  })
})

describe('round transforms', () => {
  it('openSparRound requires a running engagement and no other open round', () => {
    const planned = plannedEngagement()
    expect(() => openSparRound(planned, { id: 'r', startedAtEpochMs: NOW })).toThrow(/planned/)
    const running = runningWithOpenRound()
    expect(() => openSparRound(running, { id: 'r2', startedAtEpochMs: NOW })).toThrow(/already open/)
    const paused = transitionSparEngagement(running, 'pause')
    expect(() => openSparRound(paused, { id: 'r3', startedAtEpochMs: NOW })).toThrow(/paused/)
  })

  it('openSparRound rejects non-epoch timestamps', () => {
    const running = runningWithOpenRound()
    for (const bad of [-1, 1.5, Number.NaN, 'x' as never]) {
      expect(() => openSparRound(running, { id: 'r', startedAtEpochMs: bad })).toThrow(RangeError)
    }
  })

  it('appendSparExchange requires an open round on a running engagement', () => {
    const running = runningWithOpenRound()
    const withExchange = appendSparExchange(running, 'spar-eng-1-r1', makeExchange())
    expect(withExchange.rounds[0]?.techniques).toHaveLength(1)
    expect(running.rounds[0]?.techniques).toHaveLength(0)
    expect(() => appendSparExchange(running, 'nope', makeExchange())).toThrow(/unknown round/)
    const concluded = concludeSparRound(withExchange, 'spar-eng-1-r1', NOW + 2)
    expect(() => appendSparExchange(concluded, 'spar-eng-1-r1', makeExchange())).toThrow(/concluded/)
    expect(() => appendSparExchange(plannedEngagement(), 'spar-eng-1-r1', makeExchange())).toThrow(/planned/)
  })

  it('concludeSparRound stamps concludedAtEpochMs at or after the start', () => {
    const running = runningWithOpenRound()
    const concluded = concludeSparRound(running, 'spar-eng-1-r1', NOW + 5)
    expect(concluded.rounds[0]?.concludedAtEpochMs).toBe(NOW + 5)
    expect(() => concludeSparRound(running, 'spar-eng-1-r1', NOW - 1)).toThrow(RangeError)
    expect(() => concludeSparRound(running, 'nope', NOW + 1)).toThrow(/unknown round/)
    expect(() => concludeSparRound(concluded, 'spar-eng-1-r1', NOW + 6)).toThrow(/already concluded/)
  })
})

describe('validation', () => {
  it('isAttackTechniqueId / parseAttackTechniqueId enforce ATT&CK technique-id shape', () => {
    expect(isAttackTechniqueId('T1059')).toBe(true)
    expect(isAttackTechniqueId('T1059.001')).toBe(true)
    expect(isAttackTechniqueId('t1059')).toBe(false)
    expect(isAttackTechniqueId('T10591')).toBe(false)
    expect(isAttackTechniqueId('T105')).toBe(false)
    expect(isAttackTechniqueId('T1059.1')).toBe(false)
    expect(isAttackTechniqueId('X1059')).toBe(false)
    expect(isAttackTechniqueId('')).toBe(false)
    expect(parseAttackTechniqueId('T1114.002')).toBe('T1114.002')
    expect(() => parseAttackTechniqueId('nope')).toThrow(RangeError)
  })

  it('validateSparEngagement accepts a fully valid engagement', () => {
    const engagement = runningWithOpenRound()
    const withExchange = appendSparExchange(engagement, 'spar-eng-1-r1', makeExchange('T1114.002', 'evaded'))
    const roundTrip = validateSparEngagement(JSON.parse(JSON.stringify(withExchange)))
    expect(roundTrip).toEqual(withExchange)
  })

  it('validateSparEngagement rejects structural violations', () => {
    const base = runningWithOpenRound()
    const cases: unknown[] = [
      null,
      'nope',
      [],
      { ...base, id: '' },
      { ...base, name: 5 },
      { ...base, gardenVmName: '' },
      { ...base, adversarySource: 'metasploit' },
      { ...base, intensity: 'hourly' },
      { ...base, status: 'zombie' },
      { ...base, rounds: 'nope' },
      { ...base, rounds: [{ ...base.rounds[0], id: '' }] },
      { ...base, rounds: [{ ...base.rounds[0], startedAtEpochMs: -1 }] },
      { ...base, rounds: [{ ...base.rounds[0], startedAtEpochMs: NOW + 10, concludedAtEpochMs: NOW }] },
      {
        ...base,
        rounds: [
          {
            ...base.rounds[0],
            techniques: [{ ...makeExchange(), techniqueId: 'bogus' }]
          }
        ]
      },
      {
        ...base,
        rounds: [{ ...base.rounds[0], techniques: [{ ...makeExchange(), defenseResult: 'wobbled' }] }]
      },
      {
        ...base,
        rounds: [{ ...base.rounds[0], techniques: [{ ...makeExchange(), pointsAdversary: -1 }] }]
      },
      {
        ...base,
        rounds: [{ ...base.rounds[0], techniques: [{ ...makeExchange(), outcome: 'flawless' }] }]
      }
    ]
    for (const value of cases) {
      expect(() => validateSparEngagement(value)).toThrow(RangeError)
    }
  })

  it('validateSparRound rejects non-array techniques and non-object input', () => {
    expect(() => validateSparRound({ id: 'r', startedAtEpochMs: 0, techniques: 'nope' })).toThrow(/techniques/)
    expect(() => validateSparRound('nope')).toThrow(RangeError)
    expect(() => validateSparRound({ id: 'r', startedAtEpochMs: 0 })).toThrow(/techniques/)
  })
})
