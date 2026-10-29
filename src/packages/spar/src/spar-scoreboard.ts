/**
 * SPAR scoreboard: per-technique, per-round, and campaign aggregation over
 * validated engagements, plus the defense posture summary (detection rates and
 * weakest-technique ranking) the War Report consumes.
 *
 * Detection = the sensor fired: verdicts 'detected' (stopped) and 'contained'
 * (Chokehold capped it). 'missed' and 'evaded' are sensor failures.
 */

import type { SparEngagement, SparRound, SparTechniqueExchange } from './spar-engagement'

export type SparScore = {
  pointsAdversary: number
  pointsDefense: number
  exchanges: number
}

export const sparRoundScore = (round: SparRound): SparScore =>
  round.techniques.reduce<SparScore>(
    (total, exchange) => ({
      pointsAdversary: total.pointsAdversary + exchange.pointsAdversary,
      pointsDefense: total.pointsDefense + exchange.pointsDefense,
      exchanges: total.exchanges + 1
    }),
    { pointsAdversary: 0, pointsDefense: 0, exchanges: 0 }
  )

export const sparEngagementScore = (engagement: SparEngagement): SparScore =>
  engagement.rounds.reduce<SparScore>(
    (total, round) => {
      const roundScore = sparRoundScore(round)
      return {
        pointsAdversary: total.pointsAdversary + roundScore.pointsAdversary,
        pointsDefense: total.pointsDefense + roundScore.pointsDefense,
        exchanges: total.exchanges + roundScore.exchanges
      }
    },
    { pointsAdversary: 0, pointsDefense: 0, exchanges: 0 }
  )

export type SparTechniqueScoreboard = {
  techniqueId: string
  attempts: number
  /** Pure 'detected' verdict count; 'contained' is counted separately, both count toward detectionRate. */
  detected: number
  missed: number
  contained: number
  evaded: number
  defended: number
  breaches: number
  containedBreaches: number
  pointsAdversary: number
  pointsDefense: number
  /** (detected + contained) / attempts — the share of exchanges where a sensor fired. */
  detectionRate: number
}

const emptyTechniqueBoard = (techniqueId: string): SparTechniqueScoreboard => ({
  techniqueId,
  attempts: 0,
  detected: 0,
  missed: 0,
  contained: 0,
  evaded: 0,
  defended: 0,
  breaches: 0,
  containedBreaches: 0,
  pointsAdversary: 0,
  pointsDefense: 0,
  detectionRate: 0
})

const foldExchange = (board: SparTechniqueScoreboard, exchange: SparTechniqueExchange): SparTechniqueScoreboard => {
  const detected = board.detected + (exchange.defenseResult === 'detected' ? 1 : 0)
  const contained = board.contained + (exchange.defenseResult === 'contained' ? 1 : 0)
  const attempts = board.attempts + 1
  return {
    ...board,
    attempts,
    detected,
    contained,
    missed: board.missed + (exchange.defenseResult === 'missed' ? 1 : 0),
    evaded: board.evaded + (exchange.defenseResult === 'evaded' ? 1 : 0),
    defended: board.defended + (exchange.outcome === 'defended' ? 1 : 0),
    breaches: board.breaches + (exchange.outcome === 'breach' ? 1 : 0),
    containedBreaches: board.containedBreaches + (exchange.outcome === 'contained-breach' ? 1 : 0),
    pointsAdversary: board.pointsAdversary + exchange.pointsAdversary,
    pointsDefense: board.pointsDefense + exchange.pointsDefense,
    // Sensors fired = detected + contained; missed and evaded are sensor failures.
    detectionRate: (detected + contained) / attempts
  }
}

/** Per-technique boards across every round, sorted by techniqueId for deterministic output. */
export const sparTechniqueScoreboards = (engagement: SparEngagement): SparTechniqueScoreboard[] => {
  const boards = new Map<string, SparTechniqueScoreboard>()
  for (const round of engagement.rounds) {
    for (const exchange of round.techniques) {
      const board = boards.get(exchange.techniqueId) ?? emptyTechniqueBoard(exchange.techniqueId)
      boards.set(exchange.techniqueId, foldExchange(board, exchange))
    }
  }
  return [...boards.values()].sort((left, right) => left.techniqueId.localeCompare(right.techniqueId))
}

export type SparDefensePostureSummary = {
  exchanges: number
  /** Sensor-fired total across the campaign (detected + contained). */
  detected: number
  detectionRate: number
  defended: number
  breaches: number
  containedBreaches: number
  pointsAdversary: number
  pointsDefense: number
  /** Weakest first: detectionRate asc, then adversary points desc, then techniqueId asc. */
  weakestTechniques: SparTechniqueScoreboard[]
}

export const sparDefensePostureSummary = (engagement: SparEngagement): SparDefensePostureSummary => {
  const boards = sparTechniqueScoreboards(engagement)
  const totals = sparEngagementScore(engagement)
  // Sensor fired = detected + contained verdicts; missed and evaded are sensor failures.
  const detected = boards.reduce((sum, board) => sum + board.detected + board.contained, 0)
  const weakestTechniques = [...boards].sort((left, right) => {
    if (left.detectionRate !== right.detectionRate) {
      return left.detectionRate - right.detectionRate
    }
    if (left.pointsAdversary !== right.pointsAdversary) {
      return right.pointsAdversary - left.pointsAdversary
    }
    return left.techniqueId.localeCompare(right.techniqueId)
  })
  return {
    exchanges: totals.exchanges,
    detected,
    detectionRate: totals.exchanges === 0 ? 0 : detected / totals.exchanges,
    defended: boards.reduce((sum, board) => sum + board.defended, 0),
    breaches: boards.reduce((sum, board) => sum + board.breaches, 0),
    containedBreaches: boards.reduce((sum, board) => sum + board.containedBreaches, 0),
    pointsAdversary: totals.pointsAdversary,
    pointsDefense: totals.pointsDefense,
    weakestTechniques
  }
}
