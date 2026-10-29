#!/usr/bin/env node
/**
 * spar CLI — phase-1 referee UI. Proves the loop wiring end to end: results are
 * entered manually (phase 2 replaces `exchange` with Caldera/Mythic adapters).
 * Exit codes: 0 ok, 2 usage/argument errors, 3 state denials (mirrors armory).
 */

import {
  createSparEngagement,
  findSparRound,
  isSparAdversarySource,
  isSparDefenseResult,
  isSparIntensity,
  transitionSparEngagement,
  SPAR_DEFENSE_RESULTS,
  type SparEngagement,
  type SparEngagementId
} from './spar-engagement'
import {
  createJsonFileSparEngagementStore,
  defaultSparStorePath,
  type SparEngagementStore
} from './spar-engagement-store'
import type { SparEventSink } from './spar-events'
import { consoleAuditSink, consoleEventSink, parseFlags, SPAR_CLI_USAGE } from './spar-cli-argv'
import { renderSparScoreboard, renderSparStatus } from './spar-cli-render'
import { sparEngagementScore } from './spar-scoreboard'
import { createSparRunner, sparEngagementAuditRecord, type SparAuditSink } from './spar-runner'

export { SPAR_CLI_USAGE }

export type SparCliOptions = {
  argv: readonly string[]
  env?: NodeJS.ProcessEnv
  store?: SparEngagementStore
  events?: SparEventSink
  audits?: SparAuditSink
  nowEpochMs?: () => number
  out?: (line: string) => void
  err?: (line: string) => void
}

const replaceEngagement = (
  engagements: readonly SparEngagement[],
  next: SparEngagement
): SparEngagement[] => engagements.map((candidate) => (candidate.id === next.id ? next : candidate))


export const runSparCli = (options: SparCliOptions): number => {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`))
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`))
  const argv = options.argv
  const nowEpochMs = options.nowEpochMs ?? Date.now
  const events = options.events ?? consoleEventSink(out)
  const audits = options.audits ?? consoleAuditSink(out)
  const store = options.store ?? createJsonFileSparEngagementStore(defaultSparStorePath(options.env))
  const runner = createSparRunner({ events, audits, nowEpochMs })

  let engagements: readonly SparEngagement[]
  try {
    engagements = store.load()
  } catch (error) {
    err(`spar: store load failed: ${error instanceof Error ? error.message : String(error)}`)
    return 3
  }

  const saveAll = (next: readonly SparEngagement[]): boolean => {
    try {
      store.save(next)
    } catch (error) {
      err(`spar: store save failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    engagements = next
    return true
  }
  const withEngagement = (
    id: SparEngagementId,
    work: (engagement: SparEngagement) => SparEngagement
  ): number => {
    const engagement = engagements.find((candidate) => candidate.id === id)
    if (engagement === undefined) {
      err(`spar: unknown engagement: ${id}`)
      return 3
    }
    let next: SparEngagement
    try {
      next = work(engagement)
    } catch (error) {
      err(`spar: DENIED — ${error instanceof Error ? error.message : String(error)}`)
      return 3
    }
    return saveAll(replaceEngagement(engagements, next)) ? 0 : 3
  }

  const findWithRound = (roundId: string): SparEngagement | undefined =>
    engagements.find((candidate) => findSparRound(candidate, roundId) !== undefined)

  const verb = argv[0]

  if (verb === 'create') {
    const name = argv[1]
    const flags = parseFlags(argv.slice(2), ['garden', 'source', 'intensity'])
    if (name === undefined || name.startsWith('--') || !flags.ok) {
      err(`spar: ${flags.ok ? 'create requires a name' : flags.problem}`)
      err(SPAR_CLI_USAGE)
      return 2
    }
    const garden = flags.flags.garden
    const source = flags.flags.source
    const intensity = flags.flags.intensity
    if (garden === undefined || source === undefined || intensity === undefined) {
      err('spar: create requires --garden, --source, and --intensity')
      err(SPAR_CLI_USAGE)
      return 2
    }
    if (!isSparAdversarySource(source) || !isSparIntensity(intensity)) {
      err(`spar: --source must be caldera|mythic; --intensity must be weekly|nightly|always-on`)
      return 2
    }
    let engagement: SparEngagement
    try {
      engagement = createSparEngagement(
        { name, gardenVmName: garden, adversarySource: source, intensity },
        { nowEpochMs }
      )
    } catch (error) {
      err(`spar: DENIED — ${error instanceof Error ? error.message : String(error)}`)
      return 2
    }
    if (!saveAll([...engagements, engagement])) {
      return 3
    }
    events.publish('spar.engagement.created', {
      engagementId: engagement.id,
      name: engagement.name,
      gardenVmName: engagement.gardenVmName,
      adversarySource: engagement.adversarySource,
      intensity: engagement.intensity
    })
    audits.append(
      sparEngagementAuditRecord('spar.engagement.created', engagement, {
        gardenVmName: engagement.gardenVmName,
        adversarySource: engagement.adversarySource,
        intensity: engagement.intensity
      }, nowEpochMs)
    )
    out(`spar: engagement ${engagement.id} created (planned) garden=${garden} source=${source} intensity=${intensity}`)
    return 0
  }

  if (verb === 'start' || verb === 'pause' || verb === 'conclude') {
    const id = argv[1]
    if (id === undefined) {
      err(`spar: ${verb} requires an engagementId`)
      err(SPAR_CLI_USAGE)
      return 2
    }
    return withEngagement(id, (engagement) => {
      const resumed = verb === 'start' && engagement.status === 'paused'
      const next = transitionSparEngagement(engagement, verb)
      if (verb === 'start') {
        events.publish('spar.engagement.started', { engagementId: next.id })
        audits.append(sparEngagementAuditRecord('spar.engagement.started', next, { resumed }, nowEpochMs))
        out(`spar: engagement ${next.id} running${resumed ? ' (resumed)' : ''}`)
      } else if (verb === 'pause') {
        events.publish('spar.engagement.paused', { engagementId: next.id })
        audits.append(sparEngagementAuditRecord('spar.engagement.paused', next, {}, nowEpochMs))
        out(`spar: engagement ${next.id} paused`)
      } else {
        const score = sparEngagementScore(next)
        events.publish('spar.engagement.concluded', {
          engagementId: next.id,
          rounds: next.rounds.length,
          exchanges: score.exchanges,
          pointsAdversary: score.pointsAdversary,
          pointsDefense: score.pointsDefense
        })
        audits.append(
          sparEngagementAuditRecord('spar.engagement.concluded', next, {
            rounds: next.rounds.length,
            exchanges: score.exchanges,
            pointsAdversary: score.pointsAdversary,
            pointsDefense: score.pointsDefense
          }, nowEpochMs)
        )
        out(
          `spar: engagement ${next.id} concluded rounds=${next.rounds.length} exchanges=${score.exchanges} adversary=${score.pointsAdversary} defense=${score.pointsDefense}`
        )
      }
      return next
    })
  }

  if (verb === 'round-start') {
    const id = argv[1]
    if (id === undefined) {
      err('spar: round-start requires an engagementId')
      err(SPAR_CLI_USAGE)
      return 2
    }
    const engagement = engagements.find((candidate) => candidate.id === id)
    if (engagement === undefined) {
      err(`spar: unknown engagement: ${id}`)
      return 3
    }
    const result = runner.startRound(engagement)
    if (!result.ok) {
      err(`spar: DENIED — ${result.reason}`)
      return 3
    }
    if (!saveAll(replaceEngagement(engagements, result.engagement))) {
      return 3
    }
    out(`spar: round ${result.value.round.id} started in ${engagement.id}`)
    return 0
  }

  if (verb === 'round-conclude' || verb === 'exchange') {
    const roundId = argv[1]
    if (roundId === undefined) {
      err(`spar: ${verb} requires a roundId`)
      err(SPAR_CLI_USAGE)
      return 2
    }
    const engagement = findWithRound(roundId)
    if (engagement === undefined) {
      err(`spar: unknown round: ${roundId}`)
      return 3
    }
    if (verb === 'round-conclude') {
      const result = runner.concludeRound(engagement, roundId)
      if (!result.ok) {
        err(`spar: DENIED — ${result.reason}`)
        return 3
      }
      if (!saveAll(replaceEngagement(engagements, result.engagement))) {
        return 3
      }
      out(
        `spar: round ${roundId} concluded exchanges=${result.value.round.techniques.length}`
      )
      return 0
    }
    const techniqueId = argv[2]
    const result0 = argv[3]
    if (techniqueId === undefined || result0 === undefined) {
      err('spar: exchange requires <roundId> <techniqueId> <result>')
      err(SPAR_CLI_USAGE)
      return 2
    }
    if (!isSparDefenseResult(result0)) {
      err(`spar: result must be one of ${SPAR_DEFENSE_RESULTS.join('|')}`)
      return 2
    }
    const scored = runner.submitExchange(engagement, roundId, {
      techniqueId,
      defenseResult: result0
    })
    if (!scored.ok) {
      err(`spar: DENIED — ${scored.reason}`)
      return 3
    }
    if (!saveAll(replaceEngagement(engagements, scored.engagement))) {
      return 3
    }
    out(
      `spar: exchange ${techniqueId} ${result0} -> ${scored.value.exchange.outcome} adversary=${scored.value.exchange.pointsAdversary} defense=${scored.value.exchange.pointsDefense} (round ${roundId})`
    )
    return 0
  }

  if (verb === 'status' || verb === 'scoreboard') {
    const id = argv[1]
    if (id === undefined) {
      err(`spar: ${verb} requires an engagementId`)
      err(SPAR_CLI_USAGE)
      return 2
    }
    const engagement = engagements.find((candidate) => candidate.id === id)
    if (engagement === undefined) {
      err(`spar: unknown engagement: ${id}`)
      return 3
    }
    if (verb === 'status') {
      for (const line of renderSparStatus(engagement)) {
        out(line)
      }
      return 0
    }
    for (const line of renderSparScoreboard(engagement)) {
      out(line)
    }
    return 0
  }

  err(SPAR_CLI_USAGE)
  return 2
}

if (process.argv[1]?.endsWith('spar-cli.js') || process.argv[1]?.endsWith('spar-cli.ts')) {
  process.exitCode = runSparCli({ argv: process.argv.slice(2), env: process.env })
}
