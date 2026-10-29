/**
 * The SPAR referee: pure, deterministic scoring of one adversary action vs one
 * Sentinel defense verdict. No clock, no I/O — same input, same score, always.
 *
 * PHASE-1 SCORING TABLE (v1, encoded EXACTLY below):
 *   outcome          pointsAdversary  pointsDefense
 *   breach           3                0   (objective succeeded, sensors blind)
 *   contained-breach 1                1   (foothold gained, Chokehold capped it)
 *   defended         0                2   (detected and stopped before effect)
 * TODO(verify): balance tuning — revisit weights against War Report history
 * before phase 2 automation makes the table load-bearing.
 */

import {
  isSparDefenseResult,
  isSparOutcome,
  parseAttackTechniqueId
} from './spar-engagement'
import type { SparDefenseResult, SparOutcome, SparTechniqueExchange } from './spar-engagement'

export const SPAR_SCORING_TABLE_VERSION = 'spar-scoring-phase1-v1'

export const SPAR_SCORING_TABLE = {
  defended: { pointsAdversary: 0, pointsDefense: 2 },
  'contained-breach': { pointsAdversary: 1, pointsDefense: 1 },
  breach: { pointsAdversary: 3, pointsDefense: 0 }
} as const satisfies Record<SparOutcome, { readonly pointsAdversary: number; readonly pointsDefense: number }>

/**
 * Defense verdict -> outcome:
 *   detected  -> defended         (sensor fired, response stopped the objective)
 *   missed    -> breach           (no telemetry, adversary objective completed)
 *   contained -> contained-breach (attack landed, containment capped the effect)
 *   evaded    -> breach           (mutated variant slipped every sensor; a full
 *                                  breach to the defense, though the raw verdict
 *                                  stays distinguishable on the exchange record)
 */
export const SPAR_OUTCOME_FOR_DEFENSE_RESULT = {
  detected: 'defended',
  missed: 'breach',
  contained: 'contained-breach',
  evaded: 'breach'
} as const satisfies Record<SparDefenseResult, SparOutcome>

export type SparExchangeInput = {
  techniqueId: string
  defenseResult: SparDefenseResult
}

export type SparScoredExchange = {
  techniqueId: string
  defenseResult: SparDefenseResult
  outcome: SparOutcome
  pointsAdversary: number
  pointsDefense: number
}

/** Score one exchange; throws RangeError on invalid technique ids or verdicts (deny-by-default). */
export const scoreSparExchange = (input: SparExchangeInput): SparScoredExchange => {
  const techniqueId = parseAttackTechniqueId(input.techniqueId)
  if (!isSparDefenseResult(input.defenseResult)) {
    throw new RangeError(`invalid defense result: ${JSON.stringify(input.defenseResult)}`)
  }
  const outcome: SparOutcome = SPAR_OUTCOME_FOR_DEFENSE_RESULT[input.defenseResult]
  const score = SPAR_SCORING_TABLE[outcome]
  return {
    techniqueId,
    defenseResult: input.defenseResult,
    outcome,
    pointsAdversary: score.pointsAdversary,
    pointsDefense: score.pointsDefense
  }
}

/** Re-derive the score of a stored exchange; true when result->outcome->points all match the phase-1 table. */
export const exchangeMatchesScoringTable = (
  exchange: Pick<SparTechniqueExchange, 'techniqueId' | 'defenseResult' | 'outcome' | 'pointsAdversary' | 'pointsDefense'>
): boolean => {
  if (!isSparDefenseResult(exchange.defenseResult) || !isSparOutcome(exchange.outcome)) {
    return false
  }
  const expectedOutcome = SPAR_OUTCOME_FOR_DEFENSE_RESULT[exchange.defenseResult]
  if (exchange.outcome !== expectedOutcome) {
    return false
  }
  const expected = SPAR_SCORING_TABLE[exchange.outcome]
  return (
    exchange.pointsAdversary === expected.pointsAdversary &&
    exchange.pointsDefense === expected.pointsDefense
  )
}
