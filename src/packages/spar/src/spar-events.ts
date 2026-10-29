import type {
  SparAdversarySource,
  SparDefenseResult,
  SparEngagementId,
  SparIntensity,
  SparOutcome,
  SparRoundId
} from './spar-engagement'

/**
 * spar.* vocabulary for the octopod bus (phase 1 payloads are pure data; phase 2
 * mounts the same keys on OctopodEventMap so Caldera/Mythic adapters publish through it).
 */
export type SparEventMap = {
  'spar.engagement.created': {
    engagementId: SparEngagementId
    name: string
    gardenVmName: string
    adversarySource: SparAdversarySource
    intensity: SparIntensity
  }
  /** Entered 'running' — from 'planned' or resumed from 'paused'. */
  'spar.engagement.started': { engagementId: SparEngagementId }
  'spar.engagement.paused': { engagementId: SparEngagementId }
  'spar.engagement.concluded': {
    engagementId: SparEngagementId
    rounds: number
    exchanges: number
    pointsAdversary: number
    pointsDefense: number
  }
  'spar.round.started': {
    engagementId: SparEngagementId
    roundId: SparRoundId
    startedAtEpochMs: number
  }
  'spar.exchange.scored': {
    engagementId: SparEngagementId
    roundId: SparRoundId
    techniqueId: string
    defenseResult: SparDefenseResult
    outcome: SparOutcome
    pointsAdversary: number
    pointsDefense: number
  }
  'spar.round.concluded': {
    engagementId: SparEngagementId
    roundId: SparRoundId
    concludedAtEpochMs: number
    exchanges: number
    pointsAdversary: number
    pointsDefense: number
  }
}

/** Compile-checked enrollment of every event key (drives bus fan-out and NATS subject maps in phase 2). */
export const SPAR_EVENT_TYPES = [
  'spar.engagement.created',
  'spar.engagement.started',
  'spar.engagement.paused',
  'spar.engagement.concluded',
  'spar.round.started',
  'spar.exchange.scored',
  'spar.round.concluded'
] as const satisfies readonly (keyof SparEventMap & string)[]

export type SparEventType = keyof SparEventMap & string

export type SparEvent<Type extends SparEventType = SparEventType> = {
  type: Type
  payload: SparEventMap[Type]
  occurredAtEpochMs: number
}

/** Structural transport seam; spar stays transport-free (NATS rides with octopod in phase 2). */
export type SparEventSink = {
  publish<Type extends SparEventType>(type: Type, payload: SparEventMap[Type]): void
}
