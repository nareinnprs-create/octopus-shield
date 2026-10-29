export type {
  SparAdversarySource,
  SparDefenseResult,
  SparEngagement,
  SparEngagementAction,
  SparEngagementId,
  SparEngagementInput,
  SparIntensity,
  SparOutcome,
  SparRound,
  SparRoundId,
  SparTechniqueExchange
} from './spar-engagement'
export {
  ATTACK_TECHNIQUE_ID_PATTERN,
  createSparEngagement,
  findSparRound,
  isAttackTechniqueId,
  isRoundOpen,
  openSparRound,
  parseAttackTechniqueId,
  sparTransition,
  transitionSparEngagement,
  validateSparEngagement
} from './spar-engagement'
export {
  exchangeMatchesScoringTable,
  scoreSparExchange,
  SPAR_OUTCOME_FOR_DEFENSE_RESULT,
  SPAR_SCORING_TABLE,
  SPAR_SCORING_TABLE_VERSION,
  type SparExchangeInput,
  type SparScoredExchange
} from './spar-referee'
export {
  sparDefensePostureSummary,
  sparEngagementScore,
  sparRoundScore,
  sparTechniqueScoreboards,
  type SparDefensePostureSummary,
  type SparScore,
  type SparTechniqueScoreboard
} from './spar-scoreboard'
export {
  createSparRunner,
  sparEngagementAuditRecord,
  type SparAuditRecord,
  type SparAuditSink,
  type SparRunner,
  type SparRunnerDeps,
  type SparRunnerResult
} from './spar-runner'
export {
  SPAR_EVENT_TYPES,
  type SparEvent,
  type SparEventMap,
  type SparEventSink,
  type SparEventType
} from './spar-events'
export {
  createJsonFileSparEngagementStore,
  createMemorySparEngagementStore,
  defaultSparStorePath,
  SPAR_STORE_FORMAT_VERSION,
  type SparEngagementStore
} from './spar-engagement-store'
export { runSparCli, SPAR_CLI_USAGE, type SparCliOptions } from './spar-cli'
