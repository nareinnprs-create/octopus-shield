import { describe, expect, it } from 'vitest'

import {
  exchangeMatchesScoringTable,
  scoreSparExchange,
  SPAR_OUTCOME_FOR_DEFENSE_RESULT,
  SPAR_SCORING_TABLE,
  SPAR_SCORING_TABLE_VERSION
} from './spar-referee'

describe('phase-1 scoring table (encoded exactly)', () => {
  it('exposes the documented table verbatim', () => {
    expect(SPAR_SCORING_TABLE_VERSION).toBe('spar-scoring-phase1-v1')
    expect(SPAR_SCORING_TABLE).toEqual({
      defended: { pointsAdversary: 0, pointsDefense: 2 },
      'contained-breach': { pointsAdversary: 1, pointsDefense: 1 },
      breach: { pointsAdversary: 3, pointsDefense: 0 }
    })
  })

  it('maps every defense verdict to its outcome', () => {
    expect(SPAR_OUTCOME_FOR_DEFENSE_RESULT).toEqual({
      detected: 'defended',
      missed: 'breach',
      contained: 'contained-breach',
      evaded: 'breach'
    })
  })
})

describe('scoreSparExchange — every outcome branch', () => {
  it('detected -> defended 0/2', () => {
    expect(scoreSparExchange({ techniqueId: 'T1059', defenseResult: 'detected' })).toEqual({
      techniqueId: 'T1059',
      defenseResult: 'detected',
      outcome: 'defended',
      pointsAdversary: 0,
      pointsDefense: 2
    })
  })

  it('missed -> breach 3/0', () => {
    expect(scoreSparExchange({ techniqueId: 'T1059', defenseResult: 'missed' })).toEqual({
      techniqueId: 'T1059',
      defenseResult: 'missed',
      outcome: 'breach',
      pointsAdversary: 3,
      pointsDefense: 0
    })
  })

  it('contained -> contained-breach 1/1', () => {
    expect(scoreSparExchange({ techniqueId: 'T1114.002', defenseResult: 'contained' })).toEqual({
      techniqueId: 'T1114.002',
      defenseResult: 'contained',
      outcome: 'contained-breach',
      pointsAdversary: 1,
      pointsDefense: 1
    })
  })

  it('evaded -> breach 3/0 (mutation slipped every sensor)', () => {
    expect(scoreSparExchange({ techniqueId: 'T1114.002', defenseResult: 'evaded' })).toEqual({
      techniqueId: 'T1114.002',
      defenseResult: 'evaded',
      outcome: 'breach',
      pointsAdversary: 3,
      pointsDefense: 0
    })
  })

  it('is deterministic — identical input, identical score', () => {
    const input = { techniqueId: 'T1059.001', defenseResult: 'contained' } as const
    expect(scoreSparExchange(input)).toEqual(scoreSparExchange(input))
  })

  it('denies invalid technique ids and verdicts', () => {
    for (const techniqueId of ['T105', 'T10591', 't1059', 'T1059.1', '', 'G0000', 'nope']) {
      expect(() => scoreSparExchange({ techniqueId, defenseResult: 'detected' })).toThrow(RangeError)
    }
    for (const defenseResult of ['wobbled', '', 'DETECTED', null, 5]) {
      expect(() => scoreSparExchange({ techniqueId: 'T1059', defenseResult: defenseResult as never })).toThrow(
        RangeError
      )
    }
  })
})

describe('exchangeMatchesScoringTable — tamper check', () => {
  it('accepts exchanges whose points re-derive from the table', () => {
    const exchange = scoreSparExchange({ techniqueId: 'T1059', defenseResult: 'missed' })
    expect(exchangeMatchesScoringTable(exchange)).toBe(true)
    expect(exchangeMatchesScoringTable({ ...exchange, pointsAdversary: 99 })).toBe(false)
    expect(exchangeMatchesScoringTable({ ...exchange, pointsDefense: 2 })).toBe(false)
    expect(exchangeMatchesScoringTable({ ...exchange, outcome: 'defended' })).toBe(false)
    expect(exchangeMatchesScoringTable({ ...exchange, defenseResult: 'detected' })).toBe(false)
    expect(exchangeMatchesScoringTable({ ...exchange, outcome: 'zombie' as never })).toBe(false)
    expect(exchangeMatchesScoringTable({ ...exchange, defenseResult: 'wobbled' as never })).toBe(false)
    expect(exchangeMatchesScoringTable({ ...exchange, outcome: 'flawless' as never })).toBe(false)
  })
})
