import type { z } from 'zod'
import { defineMethod } from '../core'
import type { ShieldRuntimeService } from '../../shield-runtime'
import {
  OCTOPOD_TERMINAL_CENSUS_METHOD,
  OctopodTerminalCensusParamsSchema,
  type OctopodTerminalCensus
} from '../../../../shared/octopod-terminal-census'

const SPAWN_SETTLE_MS = 10_000
const UNVERIFIABLE: OctopodTerminalCensus = {
  liveSessions: null,
  startedSinceActivation: null,
  daemonProtocolVersion: null
}

export const OCTOPOD_TERMINAL_CENSUS_METHODS = [
  defineMethod({
    name: OCTOPOD_TERMINAL_CENSUS_METHOD,
    permission: 'host-admin',
    params: OctopodTerminalCensusParamsSchema,
    handler: async (params, { runtime }) => {
      if (params.closeAdmissionForMs === undefined) {
        return countTerminals(params, runtime)
      }
      // Before counting: a terminal admitted after the count would die with the stop, uncounted.
      const admission = runtime.terminalUpdateAdmission
      const admissionClosedUntil = admission.close(params.closeAdmissionForMs)
      // A spawn admitted before the close may still be starting; count only once it has.
      if (admissionClosedUntil > 0 && !(await admission.waitForSpawnsToSettle(SPAWN_SETTLE_MS))) {
        return { ...UNVERIFIABLE, admissionClosedUntil }
      }
      return { ...(await countTerminals(params, runtime)), admissionClosedUntil }
    }
  })
]

async function countTerminals(
  params: z.infer<typeof OctopodTerminalCensusParamsSchema>,
  runtime: Pick<ShieldRuntimeService, 'releaseFinishedAutomationRunTerminals'>
): Promise<OctopodTerminalCensus> {
  // Import lazily: daemon modules install xterm's global window and must not contaminate every dispatcher process.
  const { collectOctopodTerminalCensus } = await import('../../../octopod/octopod-terminal-census')
  if (!params.releaseFinishedAutomationTerminals) {
    return collectOctopodTerminalCensus(params.activatedAt)
  }
  const before = await collectOctopodTerminalCensus(params.activatedAt)
  const released = await runtime.releaseFinishedAutomationRunTerminals()
  return settledCensus(
    () => collectOctopodTerminalCensus(params.activatedAt),
    before.liveSessions === null ? null : before.liveSessions - released
  )
}

/** Closed sessions leave the daemon a moment after the close; wait briefly for the count to drop. */
async function settledCensus(
  collect: () => Promise<OctopodTerminalCensus>,
  expectedAtMost: number | null
): Promise<OctopodTerminalCensus> {
  let census = await collect()
  for (let attempt = 0; attempt < 15 && expectedAtMost !== null; attempt += 1) {
    if (census.liveSessions === null || census.liveSessions <= expectedAtMost) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
    census = await collect()
  }
  return census
}
