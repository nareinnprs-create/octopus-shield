import { describe, expect, it } from 'vitest'

import { appendSparExchange, concludeSparRound, openSparRound, transitionSparEngagement, type SparEngagement } from './spar-engagement'
import { createSparEngagement } from './spar-engagement'
import { scoreSparExchange } from './spar-referee'
import {
  sparDefensePostureSummary,
  sparEngagementScore,
  sparRoundScore,
  sparTechniqueScoreboards
} from './spar-scoreboard'

const NOW = 1_700_000_000_000

const exchange = (techniqueId: string, defenseResult: Parameters<typeof scoreSparExchange>[0]['defenseResult']) => ({
  ...scoreSparExchange({ techniqueId, defenseResult }),
  scoredAtEpochMs: NOW + 1
})

/** r1: T1059 detected, missed, evaded (adv 6, def 2). r2: T1114.002 contained, detected, missed (adv 4, def 3). */
const sampleEngagement = (): SparEngagement => {
  let engagement: SparEngagement = createSparEngagement(
    { name: 'nightly war', gardenVmName: 'garden-twin-01', adversarySource: 'mythic', intensity: 'nightly' },
    { id: 'spar-eng-9', nowEpochMs: () => NOW }
  )
  engagement = transitionSparEngagement(engagement, 'start')
  engagement = openSparRound(engagement, { id: 'r1', startedAtEpochMs: NOW })
  for (const result of ['detected', 'missed', 'evaded'] as const) {
    engagement = appendSparExchange(engagement, 'r1', exchange('T1059', result))
  }
  engagement = concludeSparRound(engagement, 'r1', NOW + 5)
  engagement = openSparRound(engagement, { id: 'r2', startedAtEpochMs: NOW + 6 })
  for (const result of ['contained', 'detected', 'missed'] as const) {
    engagement = appendSparExchange(engagement, 'r2', exchange('T1114.002', result))
  }
  return engagement
}

describe('sparRoundScore / sparEngagementScore', () => {
  it('sums a round: 2 defended=0/2 + 2 breaches=6/0', () => {
    const engagement = sampleEngagement()
    const r1 = engagement.rounds.find((round) => round.id === 'r1')
    if (r1 === undefined) {
      throw new Error('missing r1')
    }
    expect(sparRoundScore(r1)).toEqual({ pointsAdversary: 6, pointsDefense: 2, exchanges: 3 })
  })

  it('aggregates across rounds', () => {
    expect(sparEngagementScore(sampleEngagement())).toEqual({
      pointsAdversary: 10,
      pointsDefense: 5,
      exchanges: 6
    })
  })

  it('scores empty engagements and empty rounds as zeros', () => {
    const planned = createSparEngagement(
      { name: 'x', gardenVmName: 'vm', adversarySource: 'caldera', intensity: 'weekly' },
      { id: 'e', nowEpochMs: () => NOW }
    )
    expect(sparEngagementScore(planned)).toEqual({ pointsAdversary: 0, pointsDefense: 0, exchanges: 0 })
    const withEmptyRound = openSparRound(transitionSparEngagement(planned, 'start'), {
      id: 'r',
      startedAtEpochMs: NOW
    })
    expect(sparRoundScore(withEmptyRound.rounds[0]!)).toEqual({ pointsAdversary: 0, pointsDefense: 0, exchanges: 0 })
  })
})

describe('sparTechniqueScoreboards', () => {
  it('counts verdicts, outcomes, points, and detection rate per technique', () => {
    const boards = sparTechniqueScoreboards(sampleEngagement())
    expect(boards.map((board) => board.techniqueId)).toEqual(['T1059', 'T1114.002'])

    const t1059 = boards.find((board) => board.techniqueId === 'T1059')
    expect(t1059).toMatchObject({
      attempts: 3,
      detected: 1,
      contained: 0,
      missed: 1,
      evaded: 1,
      defended: 1,
      breaches: 2,
      containedBreaches: 0,
      pointsAdversary: 6,
      pointsDefense: 2
    })
    // sensor fired for 'detected' only = 1 of 3
    expect(t1059?.detectionRate).toBeCloseTo(1 / 3)

    const t1114 = boards.find((board) => board.techniqueId === 'T1114.002')
    expect(t1114).toMatchObject({
      attempts: 3,
      detected: 1,
      contained: 1,
      missed: 1,
      evaded: 0,
      defended: 1,
      breaches: 1,
      containedBreaches: 1,
      pointsAdversary: 4,
      pointsDefense: 3
    })
    // sensor fired for 'detected' + 'contained' = 2 of 3
    expect(t1114?.detectionRate).toBeCloseTo(2 / 3)
  })
})

describe('sparDefensePostureSummary', () => {
  it('summarizes campaign posture', () => {
    const posture = sparDefensePostureSummary(sampleEngagement())
    expect(posture.exchanges).toBe(6)
    expect(posture.detected).toBe(3)
    expect(posture.detectionRate).toBeCloseTo(0.5)
    expect(posture.defended).toBe(2)
    expect(posture.breaches).toBe(3)
    expect(posture.containedBreaches).toBe(1)
    expect(posture.pointsAdversary).toBe(10)
    expect(posture.pointsDefense).toBe(5)
  })

  it('ranks weakest techniques: rate asc, then adversary points desc, then id asc', () => {
    let engagement: SparEngagement = createSparEngagement(
      { name: 'tiebreak', gardenVmName: 'vm', adversarySource: 'caldera', intensity: 'weekly' },
      { id: 'e', nowEpochMs: () => NOW }
    )
    engagement = transitionSparEngagement(engagement, 'start')
    engagement = openSparRound(engagement, { id: 'r', startedAtEpochMs: NOW })
    // T1059: one miss  -> rate 0, adv 3
    // T1110: one miss  -> rate 0, adv 3 (full tie with T1059 -> id asc wins)
    // T1114.002: one contained -> rate 1, adv 1
    for (const [technique, result] of [
      ['T1059', 'missed'],
      ['T1110', 'missed'],
      ['T1114.002', 'contained']
    ] as const) {
      engagement = appendSparExchange(engagement, 'r', exchange(technique, result))
    }
    const posture = sparDefensePostureSummary(engagement)
    expect(posture.weakestTechniques.map((board) => board.techniqueId)).toEqual([
      'T1059',
      'T1110',
      'T1114.002'
    ])
  })

  it('breaks rate ties by adversary points descending', () => {
    let engagement: SparEngagement = createSparEngagement(
      { name: 'tiebreak2', gardenVmName: 'vm', adversarySource: 'caldera', intensity: 'weekly' },
      { id: 'e', nowEpochMs: () => NOW }
    )
    engagement = transitionSparEngagement(engagement, 'start')
    engagement = openSparRound(engagement, { id: 'r', startedAtEpochMs: NOW })
    // Both rate 0 (all sensor failures); T1027 carries 2 breaches (adv 6) and must
    // rank before T1028's single breach (adv 3).
    engagement = appendSparExchange(engagement, 'r', exchange('T1028', 'evaded'))
    engagement = appendSparExchange(engagement, 'r', exchange('T1027', 'missed'))
    engagement = appendSparExchange(engagement, 'r', exchange('T1027', 'evaded'))
    const posture = sparDefensePostureSummary(engagement)
    expect(posture.weakestTechniques.map((board) => board.techniqueId)).toEqual(['T1027', 'T1028'])
  })

  it('handles an engagement with no exchanges', () => {
    const planned = createSparEngagement(
      { name: 'x', gardenVmName: 'vm', adversarySource: 'caldera', intensity: 'weekly' },
      { id: 'e', nowEpochMs: () => NOW }
    )
    const posture = sparDefensePostureSummary(planned)
    expect(posture.exchanges).toBe(0)
    expect(posture.detectionRate).toBe(0)
    expect(posture.weakestTechniques).toEqual([])
  })
})
