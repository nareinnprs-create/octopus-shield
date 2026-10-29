/**
 * SPAR round runner: the audited loop skeleton. startRound / submitExchange /
 * concludeRound run the pure engagement transforms through injected event and
 * audit sinks. Phase 1 feeds exchanges manually (the referee UI pre-dating
 * automation); phase 2 wires Caldera/Mythic adapters as exchange producers and
 * Sentinel detection state as the defense verdict source. Nothing here
 * executes attacks.
 */

import type { SparRoundId, SparTechniqueExchange } from './spar-engagement'
import type { SparEngagement, SparRound } from './spar-engagement'
import {
  appendSparExchange,
  concludeSparRound,
  openSparRound
} from './spar-engagement'
import { scoreSparExchange, type SparExchangeInput } from './spar-referee'
import { sparRoundScore } from './spar-scoreboard'
import type { SparEventMap, SparEventSink, SparEventType } from './spar-events'

/** Same shape as @shield/access AuditEvent (actor_kind='tentacle'); structurally defined to keep spar dependency-free. */
export type SparAuditRecord = {
  tsEpochMs: number
  actorKind: 'tentacle'
  actorId: 'spar'
  action: string
  resourceKind: 'spar-engagement' | 'spar-round'
  resourceId: string
  traceId: null
  payload: Record<string, unknown>
}

/** Structural seam; the @shield/access hash chain plugs in as the system of record in phase 2. */
export type SparAuditSink = {
  append(record: SparAuditRecord): void
}

export type SparRunnerDeps = {
  events: SparEventSink
  audits: SparAuditSink
  nowEpochMs?: () => number
}

export type SparRunnerOk<T> = { ok: true; engagement: SparEngagement; value: T }
export type SparRunnerDenial = { ok: false; reason: string }
export type SparRunnerResult<T> = SparRunnerOk<T> | SparRunnerDenial

export type SparRunner = {
  startRound: (engagement: SparEngagement) => SparRunnerResult<{ round: SparRound }>
  submitExchange: (
    engagement: SparEngagement,
    roundId: SparRoundId,
    input: SparExchangeInput
  ) => SparRunnerResult<{ exchange: SparTechniqueExchange }>
  concludeRound: (engagement: SparEngagement, roundId: SparRoundId) => SparRunnerResult<{ round: SparRound }>
}

const ok = <T>(engagement: SparEngagement, value: T): SparRunnerOk<T> => ({ ok: true, engagement, value })
const denied = (reason: string): SparRunnerDenial => ({ ok: false, reason })

const sparAuditRecord = (
  action: string,
  resourceKind: SparAuditRecord['resourceKind'],
  resourceId: string,
  payload: Record<string, unknown>,
  nowEpochMs: () => number
): SparAuditRecord => ({
  tsEpochMs: nowEpochMs(),
  actorKind: 'tentacle',
  actorId: 'spar',
  action,
  resourceKind,
  resourceId,
  traceId: null,
  payload
})

/** Audit action names for engagement lifecycle transitions. */
export type SparEngagementAuditAction =
  | 'spar.engagement.created'
  | 'spar.engagement.started'
  | 'spar.engagement.paused'
  | 'spar.engagement.concluded'

/** Audit-shaped record for an engagement lifecycle transition (created/started/paused/concluded). */
export const sparEngagementAuditRecord = (
  action: SparEngagementAuditAction,
  engagement: SparEngagement,
  payload: Record<string, unknown>,
  nowEpochMs: () => number = Date.now
): SparAuditRecord =>
  sparAuditRecord(action, 'spar-engagement', engagement.id, payload, nowEpochMs)

/**
 * State denials (illegal transitions, unknown/concluded rounds) come back as
 * { ok: false, reason } with NO emissions; RangeError from the pure layer is
 * the denial vehicle and is converted here. Anything else still throws.
 */
const runPure = <T>(work: () => SparRunnerResult<T>): SparRunnerResult<T> => {
  try {
    return work()
  } catch (error) {
    if (error instanceof RangeError) {
      return denied(error.message)
    }
    throw error
  }
}

export const createSparRunner = (deps: SparRunnerDeps): SparRunner => {
  const nowEpochMs = deps.nowEpochMs ?? Date.now
  const emit = <Type extends SparEventType>(type: Type, payload: SparEventMap[Type]): void => {
    deps.events.publish(type, payload)
  }
  const audit = (
    action: string,
    resourceKind: SparAuditRecord['resourceKind'],
    resourceId: string,
    payload: Record<string, unknown>
  ): void => {
    deps.audits.append(sparAuditRecord(action, resourceKind, resourceId, payload, nowEpochMs))
  }

  return {
    startRound: (engagement) =>
      runPure(() => {
        const roundId = `${engagement.id}-r${engagement.rounds.length + 1}`
        const startedAtEpochMs = nowEpochMs()
        const next = openSparRound(engagement, { id: roundId, startedAtEpochMs })
        const round = next.rounds.find((candidate) => candidate.id === roundId)
        if (round === undefined) {
          return denied(`round ${roundId} missing after open`)
        }
        emit('spar.round.started', { engagementId: engagement.id, roundId, startedAtEpochMs })
        audit('spar.round.started', 'spar-round', roundId, {
          engagementId: engagement.id,
          startedAtEpochMs
        })
        return ok(next, { round })
      }),

    submitExchange: (engagement, roundId, input) =>
      runPure(() => {
        const scored = scoreSparExchange(input)
        const scoredAtEpochMs = nowEpochMs()
        const exchange: SparTechniqueExchange = { ...scored, scoredAtEpochMs }
        const next = appendSparExchange(engagement, roundId, exchange)
        emit('spar.exchange.scored', {
          engagementId: engagement.id,
          roundId,
          techniqueId: scored.techniqueId,
          defenseResult: scored.defenseResult,
          outcome: scored.outcome,
          pointsAdversary: scored.pointsAdversary,
          pointsDefense: scored.pointsDefense
        })
        audit('spar.exchange.scored', 'spar-round', roundId, {
          engagementId: engagement.id,
          techniqueId: scored.techniqueId,
          defenseResult: scored.defenseResult,
          outcome: scored.outcome,
          pointsAdversary: scored.pointsAdversary,
          pointsDefense: scored.pointsDefense,
          scoredAtEpochMs
        })
        return ok(next, { exchange })
      }),

    concludeRound: (engagement, roundId) =>
      runPure(() => {
        const concludedAtEpochMs = nowEpochMs()
        const next = concludeSparRound(engagement, roundId, concludedAtEpochMs)
        const round = next.rounds.find((candidate) => candidate.id === roundId)
        if (round === undefined) {
          return denied(`round ${roundId} missing after conclude`)
        }
        const score = sparRoundScore(round)
        emit('spar.round.concluded', {
          engagementId: engagement.id,
          roundId,
          concludedAtEpochMs,
          exchanges: score.exchanges,
          pointsAdversary: score.pointsAdversary,
          pointsDefense: score.pointsDefense
        })
        audit('spar.round.concluded', 'spar-round', roundId, {
          engagementId: engagement.id,
          concludedAtEpochMs,
          exchanges: score.exchanges,
          pointsAdversary: score.pointsAdversary,
          pointsDefense: score.pointsDefense
        })
        return ok(next, { round })
      })
  }
}
