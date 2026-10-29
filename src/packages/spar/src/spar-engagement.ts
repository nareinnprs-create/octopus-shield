/**
 * SPAR engagement model (EXPANSION_PLAN_V1.1 §6): pure data, validation, the
 * engagement state machine, and the pure round transforms the runner audits.
 * Nothing here executes attacks — phase 2 wires Caldera/Mythic adapters.
 */

export type SparEngagementId = string
export type SparRoundId = string

export type SparAdversarySource = 'caldera' | 'mythic'
export type SparIntensity = 'weekly' | 'nightly' | 'always-on'
export type SparEngagementStatus = 'planned' | 'running' | 'paused' | 'concluded'

/** Sentinel detection verdict for one adversary action (phase 1: entered manually; phase 2: from detection state). */
export type SparDefenseResult = 'detected' | 'missed' | 'contained' | 'evaded'

export type SparOutcome = 'defended' | 'breach' | 'contained-breach'

export type SparTechniqueExchange = {
  /** ATT&CK technique id from the Caldera ability / Mythic tradecraft mapping (e.g. T1059, T1059.001). */
  techniqueId: string
  defenseResult: SparDefenseResult
  outcome: SparOutcome
  pointsAdversary: number
  pointsDefense: number
  scoredAtEpochMs: number
}

export type SparRound = {
  id: SparRoundId
  startedAtEpochMs: number
  concludedAtEpochMs?: number
  techniques: SparTechniqueExchange[]
}

export type SparEngagement = {
  id: SparEngagementId
  name: string
  /** A Gardens VM name (@shield/gardens-vm); the digital twin the engagement fights on. */
  gardenVmName: string
  adversarySource: SparAdversarySource
  intensity: SparIntensity
  status: SparEngagementStatus
  rounds: SparRound[]
}

export const SPAR_ADVERSARY_SOURCES = ['caldera', 'mythic'] as const
export const SPAR_INTENSITIES = ['weekly', 'nightly', 'always-on'] as const
export const SPAR_ENGAGEMENT_STATUSES = ['planned', 'running', 'paused', 'concluded'] as const
export const SPAR_DEFENSE_RESULTS = ['detected', 'missed', 'contained', 'evaded'] as const
export const SPAR_OUTCOMES = ['defended', 'breach', 'contained-breach'] as const

/**
 * planned -> running -> paused <-> running -> concluded; no skips.
 * 'start' doubles as resume (paused -> running).
 */
export type SparEngagementAction = 'start' | 'pause' | 'conclude'

const SPAR_ENGAGEMENT_TRANSITIONS: Readonly<
  Record<SparEngagementStatus, Partial<Record<SparEngagementAction, SparEngagementStatus>>>
> = {
  planned: { start: 'running' },
  running: { pause: 'paused', conclude: 'concluded' },
  paused: { start: 'running' },
  concluded: {}
}

/** ATT&CK technique id: base T#### or sub-technique T####.### (tactics/mappings not accepted). */
export const ATTACK_TECHNIQUE_ID_PATTERN = /^T\d{4}(?:\.\d{3})?$/

export const isAttackTechniqueId = (value: unknown): value is string =>
  typeof value === 'string' && ATTACK_TECHNIQUE_ID_PATTERN.test(value)

/** Deny-by-default parse: throws RangeError on anything outside the ATT&CK technique-id shape. */
export const parseAttackTechniqueId = (value: unknown): string => {
  if (!isAttackTechniqueId(value)) {
    throw new RangeError(`invalid ATT&CK technique id: ${JSON.stringify(value)}`)
  }
  return value
}

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.some((candidate) => candidate === value)

export const isSparAdversarySource = isOneOf(SPAR_ADVERSARY_SOURCES)
export const isSparIntensity = isOneOf(SPAR_INTENSITIES)
export const isSparEngagementStatus = isOneOf(SPAR_ENGAGEMENT_STATUSES)
export const isSparDefenseResult = isOneOf(SPAR_DEFENSE_RESULTS)
export const isSparOutcome = isOneOf(SPAR_OUTCOMES)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const requireString = (record: Record<string, unknown>, field: string): string => {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${field} must be a non-empty string`)
  }
  return value
}

const requireEnum = <T extends string>(
  record: Record<string, unknown>,
  field: string,
  guard: (value: unknown) => value is T
): T => {
  const value = record[field]
  if (!guard(value)) {
    throw new RangeError(`invalid ${field}: ${JSON.stringify(value)}`)
  }
  return value
}

const requireEpochMs = (record: Record<string, unknown>, field: string): number => {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer (epoch ms)`)
  }
  return value
}

const requirePoints = (record: Record<string, unknown>, field: string): number => {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative safe integer`)
  }
  return value
}

export const validateSparTechniqueExchange = (value: unknown): SparTechniqueExchange => {
  const record = isRecord(value) ? value : null
  if (record === null) {
    throw new RangeError('technique exchange must be an object')
  }
  const exchange: SparTechniqueExchange = {
    techniqueId: parseAttackTechniqueId(record.techniqueId),
    defenseResult: requireEnum(record, 'defenseResult', isSparDefenseResult),
    outcome: requireEnum(record, 'outcome', isSparOutcome),
    pointsAdversary: requirePoints(record, 'pointsAdversary'),
    pointsDefense: requirePoints(record, 'pointsDefense'),
    scoredAtEpochMs: requireEpochMs(record, 'scoredAtEpochMs')
  }
  return exchange
}

export const validateSparRound = (value: unknown): SparRound => {
  const record = isRecord(value) ? value : null
  if (record === null) {
    throw new RangeError('round must be an object')
  }
  const id = requireString(record, 'id')
  const startedAtEpochMs = requireEpochMs(record, 'startedAtEpochMs')
  const concludedRaw = record.concludedAtEpochMs
  const concludedAtEpochMs =
    concludedRaw === undefined ? undefined : requireEpochMs(record, 'concludedAtEpochMs')
  if (concludedAtEpochMs !== undefined && concludedAtEpochMs < startedAtEpochMs) {
    throw new RangeError(`round ${id}: concludedAtEpochMs is before startedAtEpochMs`)
  }
  const techniquesRaw = record.techniques
  if (!Array.isArray(techniquesRaw)) {
    throw new RangeError(`round ${id}: techniques must be an array`)
  }
  const round: SparRound = {
    id,
    startedAtEpochMs,
    ...(concludedAtEpochMs !== undefined ? { concludedAtEpochMs } : {}),
    techniques: techniquesRaw.map(validateSparTechniqueExchange)
  }
  return round
}

/** Deep structural validation; throws RangeError naming the first violated field. */
export const validateSparEngagement = (value: unknown): SparEngagement => {
  const record = isRecord(value) ? value : null
  if (record === null) {
    throw new RangeError('engagement must be an object')
  }
  const fields = {
    id: requireString(record, 'id'),
    name: requireString(record, 'name'),
    gardenVmName: requireString(record, 'gardenVmName'),
    adversarySource: requireEnum(record, 'adversarySource', isSparAdversarySource),
    intensity: requireEnum(record, 'intensity', isSparIntensity),
    status: requireEnum(record, 'status', isSparEngagementStatus)
  } satisfies Omit<SparEngagement, 'rounds'>
  const roundsRaw = record.rounds
  if (!Array.isArray(roundsRaw)) {
    throw new RangeError(`engagement ${fields.id}: rounds must be an array`)
  }
  return { ...fields, rounds: roundsRaw.map(validateSparRound) }
}

export type SparEngagementInput = {
  name: string
  gardenVmName: string
  adversarySource: SparAdversarySource
  intensity: SparIntensity
}

/** Factory for a fresh 'planned' engagement; inject id/nowEpochMs for deterministic tests. */
export const createSparEngagement = (
  input: SparEngagementInput,
  options?: { id?: SparEngagementId; nowEpochMs?: () => number }
): SparEngagement => {
  const nowEpochMs = options?.nowEpochMs ?? Date.now
  const name = input.name
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new RangeError('engagement name must be a non-empty string')
  }
  if (typeof input.gardenVmName !== 'string' || input.gardenVmName.trim().length === 0) {
    throw new RangeError('gardenVmName must be a non-empty Gardens VM name')
  }
  if (!isSparAdversarySource(input.adversarySource)) {
    throw new RangeError(`unknown adversary source: ${JSON.stringify(input.adversarySource)}`)
  }
  if (!isSparIntensity(input.intensity)) {
    throw new RangeError(`unknown intensity: ${JSON.stringify(input.intensity)}`)
  }
  return {
    id: options?.id ?? `spar-eng-${nowEpochMs()}`,
    name,
    gardenVmName: input.gardenVmName,
    adversarySource: input.adversarySource,
    intensity: input.intensity,
    status: 'planned',
    rounds: []
  }
}

/** null when the transition is illegal (no skips); callers turn null into a denial. */
export const sparTransition = (
  status: SparEngagementStatus,
  action: SparEngagementAction
): SparEngagementStatus | null => SPAR_ENGAGEMENT_TRANSITIONS[status][action] ?? null

export const isRoundOpen = (round: SparRound): boolean => round.concludedAtEpochMs === undefined

export const findSparRound = (
  engagement: SparEngagement,
  roundId: SparRoundId
): SparRound | undefined => engagement.rounds.find((round) => round.id === roundId)

export const openSparRoundOf = (engagement: SparEngagement): SparRound | undefined =>
  engagement.rounds.find(isRoundOpen)

/**
 * Illegal transitions and state denials throw RangeError; the runner converts
 * them into { ok: false, reason } denials, the CLI into exit code 3.
 */
export const transitionSparEngagement = (
  engagement: SparEngagement,
  action: SparEngagementAction
): SparEngagement => {
  const next = sparTransition(engagement.status, action)
  if (next === null) {
    throw new RangeError(`illegal engagement transition: ${action} from ${engagement.status}`)
  }
  if (next === 'concluded') {
    const open = openSparRoundOf(engagement)
    if (open !== undefined) {
      throw new RangeError(`engagement cannot conclude while round ${open.id} is open`)
    }
  }
  return { ...engagement, status: next }
}

export const openSparRound = (
  engagement: SparEngagement,
  round: { id: SparRoundId; startedAtEpochMs: number }
): SparEngagement => {
  if (engagement.status !== 'running') {
    throw new RangeError(`rounds require a running engagement (status: ${engagement.status})`)
  }
  const open = openSparRoundOf(engagement)
  if (open !== undefined) {
    throw new RangeError(`round ${open.id} is already open; conclude it before starting another`)
  }
  if (typeof round.startedAtEpochMs !== 'number' || !Number.isSafeInteger(round.startedAtEpochMs) || round.startedAtEpochMs < 0) {
    throw new RangeError('startedAtEpochMs must be a non-negative safe integer (epoch ms)')
  }
  const fresh: SparRound = { id: round.id, startedAtEpochMs: round.startedAtEpochMs, techniques: [] }
  return { ...engagement, rounds: [...engagement.rounds, fresh] }
}

export const appendSparExchange = (
  engagement: SparEngagement,
  roundId: SparRoundId,
  exchange: SparTechniqueExchange
): SparEngagement => {
  validateSparTechniqueExchange(exchange)
  if (engagement.status !== 'running') {
    throw new RangeError(`exchanges require a running engagement (status: ${engagement.status})`)
  }
  const round = findSparRound(engagement, roundId)
  if (round === undefined) {
    throw new RangeError(`unknown round: ${roundId}`)
  }
  if (!isRoundOpen(round)) {
    throw new RangeError(`round ${roundId} is concluded; no further exchanges`)
  }
  return {
    ...engagement,
    rounds: engagement.rounds.map((candidate) =>
      candidate.id === roundId
        ? { ...candidate, techniques: [...candidate.techniques, exchange] }
        : candidate
    )
  }
}

export const concludeSparRound = (
  engagement: SparEngagement,
  roundId: SparRoundId,
  concludedAtEpochMs: number
): SparEngagement => {
  if (engagement.status !== 'running') {
    throw new RangeError(`rounds conclude on a running engagement (status: ${engagement.status})`)
  }
  const round = findSparRound(engagement, roundId)
  if (round === undefined) {
    throw new RangeError(`unknown round: ${roundId}`)
  }
  if (!isRoundOpen(round)) {
    throw new RangeError(`round ${roundId} is already concluded`)
  }
  if (!Number.isSafeInteger(concludedAtEpochMs) || concludedAtEpochMs < round.startedAtEpochMs) {
    throw new RangeError(`concludedAtEpochMs must be at or after ${round.startedAtEpochMs}`)
  }
  return {
    ...engagement,
    rounds: engagement.rounds.map((candidate) =>
      candidate.id === roundId ? { ...candidate, concludedAtEpochMs } : candidate
    )
  }
}
