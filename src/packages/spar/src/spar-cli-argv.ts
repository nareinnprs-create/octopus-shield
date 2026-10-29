/**
 * spar CLI plumbing: usage text, --flag parsing, and the default console
 * sinks. Split from the dispatcher to keep each file focused.
 */

import type { SparAuditRecord, SparAuditSink } from './spar-runner'
import type { SparEventSink } from './spar-events'

export const SPAR_CLI_USAGE = `usage:
  spar create <name> --garden <vmName> --source <caldera|mythic> --intensity <weekly|nightly|always-on>
  spar start <engagementId> | pause <engagementId> | conclude <engagementId>
  spar round-start <engagementId> | round-conclude <roundId>
  spar exchange <roundId> <Txxxx[.xxx]> <detected|missed|contained|evaded>
  spar status <engagementId> | scoreboard <engagementId>`

/** Parses strict `--flag value` pairs; unknown flags and valueless flags fail. */
export const parseFlags = (
  argv: readonly string[],
  allowed: readonly string[]
): { ok: true; flags: Record<string, string> } | { ok: false; problem: string } => {
  const flags: Record<string, string> = {}
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag.startsWith('--') || !allowed.includes(flag.slice(2))) {
      return { ok: false, problem: `unexpected argument: ${JSON.stringify(flag)}` }
    }
    if (value === undefined || value.startsWith('--')) {
      return { ok: false, problem: `flag ${flag} requires a value` }
    }
    flags[flag.slice(2)] = value
  }
  return { ok: true, flags }
}

export const consoleEventSink = (out: (line: string) => void): SparEventSink => ({
  publish: (type, payload) => out(`event ${type} ${JSON.stringify(payload)}`)
})

export const consoleAuditSink = (out: (line: string) => void): SparAuditSink => ({
  append: (record: SparAuditRecord) => out(`audit ${JSON.stringify(record)}`)
})
