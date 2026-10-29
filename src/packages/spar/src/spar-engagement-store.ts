/**
 * SparEngagement persistence for the phase-1 referee CLI. Machine-local JSON
 * convenience store — the @shield/access audit chain is the tamper-evident
 * system of record (same stance as Armory run history). Loaded engagements are
 * deep-validated and re-scored against the phase-1 referee table, so a
 * hand-edited or stale store fails closed instead of skewing scoreboards.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SparEngagement } from './spar-engagement'
import { validateSparEngagement } from './spar-engagement'
import { exchangeMatchesScoringTable } from './spar-referee'

export const SPAR_STORE_FORMAT_VERSION = 1

export type SparEngagementStore = {
  load: () => readonly SparEngagement[]
  save: (engagements: readonly SparEngagement[]) => void
}

export const createMemorySparEngagementStore = (
  initial: readonly SparEngagement[] = []
): SparEngagementStore => {
  let engagements: readonly SparEngagement[] = initial
  return {
    load: () => engagements,
    save: (next) => {
      engagements = next
    }
  }
}

/** OSHIELD_SPAR_STORE wins; default lives under the machine temp dir. */
export const defaultSparStorePath = (env: NodeJS.ProcessEnv = process.env): string =>
  env.OSHIELD_SPAR_STORE ?? join(tmpdir(), 'oshield-spar', 'engagements.json')

const rejectTamperedScoring = (engagement: SparEngagement, index: number): SparEngagement => {
  for (const round of engagement.rounds) {
    for (const exchange of round.techniques) {
      if (!exchangeMatchesScoringTable(exchange)) {
        throw new RangeError(
          `engagement[${index}] round ${round.id} exchange ${exchange.techniqueId} does not match the phase-1 scoring table`
        )
      }
    }
  }
  return engagement
}

export const createJsonFileSparEngagementStore = (filePath: string): SparEngagementStore => ({
  load: () => {
    let raw: string
    try {
      raw = readFileSync(filePath, 'utf8')
    } catch {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
    if (
      record === null ||
      record.engagements === undefined ||
      record.version !== SPAR_STORE_FORMAT_VERSION ||
      !Array.isArray(record.engagements)
    ) {
      throw new RangeError(`spar store ${filePath} is not a version ${SPAR_STORE_FORMAT_VERSION} engagement store`)
    }
    // SAFETY: engagements is checked to be an Array immediately above.
    const list = record.engagements as unknown[]
    return list.map((entry, index) =>
      rejectTamperedScoring(validateSparEngagement(entry), index)
    )
  },
  save: (engagements) => {
    const validated = engagements.map((entry, index) =>
      rejectTamperedScoring(validateSparEngagement(entry), index)
    )
    // Non-atomic write on purpose: convenience cache only; the audit chain is authoritative.
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(
      filePath,
      `${JSON.stringify({ version: SPAR_STORE_FORMAT_VERSION, engagements: validated }, null, 2)}\n`
    )
  }
})
