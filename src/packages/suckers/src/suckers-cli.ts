#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  noopSuckerProcess,
  SuckerBroker,
  type SuckerBrokerOptions,
  type SuckerPersistedRecord,
  type SuckerProcessLike
} from './sucker-broker'
import { parseSuckerManifest, parseSuckerManifestJson } from './sucker-manifest'

/**
 * Suckers CLI: list | install <manifest.json> | revoke <id> |
 * run <id> <capability> [--json-args '<json>'].
 *
 * v0 wiring harness: broker state persists to a JSON state file (env
 * OSHIELD_SUCKERS_STATE, default %TEMP%\opencode\suckers\state.json) so
 * install → run → revoke spans invocations; the default process adapter is
 * a NOOP (proves the broker→spawn seam), and install folds the attest/grant
 * steps by approving every requested row until the human approval flow
 * lands (flagged in the install output).
 */

export type SuckersCliOptions = {
  argv: readonly string[]
  spawn?: SuckerProcessLike
  onAuditEvent?: SuckerBrokerOptions['onAuditEvent']
  statePath?: string
  out?: (line: string) => void
  err?: (line: string) => void
}

const USAGE =
  "usage: suckers list | install <manifest.json> | revoke <id> | run <id> <capability> [--json-args '<json>']"

const STATE_VERSION = 1

const stateFilePath = (explicit?: string): string =>
  explicit ??
  process.env.OSHIELD_SUCKERS_STATE ??
  join(tmpdir(), 'opencode', 'suckers', 'state.json')

type RawState = { version?: unknown; suckers?: unknown }

/**
 * Rehydrates broker state; malformed entries are skipped, never guessed —
 * a half-read state file denies by default instead of granting.
 */
function loadState(broker: SuckerBroker, path: string, err: (line: string) => void): void {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return
  }
  let decoded: RawState
  try {
    decoded = JSON.parse(raw) as RawState
  } catch {
    err(`suckers: state file unreadable, starting empty: ${path}`)
    return
  }
  if (decoded.version !== STATE_VERSION || !Array.isArray(decoded.suckers)) {
    err(`suckers: state file version unrecognized, starting empty: ${path}`)
    return
  }
  for (const entry of decoded.suckers as unknown[]) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const record = entry as { manifest?: unknown; status?: unknown; grants?: unknown }
    const parsed = parseSuckerManifest(record.manifest)
    if (!parsed.ok) {
      continue
    }
    broker.restore({
      manifest: parsed.manifest,
      status:
        record.status === 'granted' || record.status === 'revoked' ? record.status : 'installed',
      grants: Array.isArray(record.grants) ? (record.grants as SuckerPersistedRecord['grants']) : []
    })
  }
}

function saveState(broker: SuckerBroker, path: string, err: (line: string) => void): void {
  const state = { version: STATE_VERSION, suckers: broker.snapshot() }
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(state))
  } catch (error) {
    err(
      `suckers: state save failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

/** --json-args must decode to a spawn-shaped argv: an array of strings. */
function parseJsonArgs(raw: string): { ok: true; args: string[] } | { ok: false; reason: string } {
  let decoded: unknown
  try {
    decoded = JSON.parse(raw) as unknown
  } catch {
    return { ok: false, reason: '--json-args is not valid JSON' }
  }
  if (!Array.isArray(decoded) || decoded.some((arg) => typeof arg !== 'string')) {
    return { ok: false, reason: '--json-args must decode to an array of strings' }
  }
  return { ok: true, args: decoded }
}

export async function runSuckersCli(options: SuckersCliOptions): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`))
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`))
  const argv = options.argv
  const broker = new SuckerBroker({
    spawn: options.spawn ?? noopSuckerProcess,
    onAuditEvent: options.onAuditEvent
  })
  const statePath = stateFilePath(options.statePath)
  loadState(broker, statePath, err)

  if (argv[0] === 'list') {
    const summaries = broker.list()
    for (const summary of summaries) {
      out(
        `${summary.status.padEnd(9)} ${summary.kind.padEnd(17)} ${summary.tier.padEnd(14)} ${summary.id}@${summary.version} grants=${summary.grantCount}/${summary.requestedCount}`
      )
    }
    out(`${summaries.length} suckers`)
    return 0
  }

  if (argv[0] === 'install') {
    const path = argv[1]
    if (path === undefined) {
      err(USAGE)
      return 2
    }
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      err(
        `suckers: cannot read manifest: ${error instanceof Error ? error.message : String(error)}`
      )
      return 2
    }
    const parsed = parseSuckerManifestJson(text)
    if (!parsed.ok) {
      err(`suckers: manifest rejected — ${parsed.reason}`)
      return 2
    }
    const installed = await broker.install(parsed.manifest)
    if (!installed.ok) {
      err(`suckers: install denied — ${installed.reason}`)
      return 3
    }
    out(`audit ${JSON.stringify(installed.auditEvent)}`)
    // v0 fold: attest/grant are human steps in the contract; until that
    // approval flow lands, install approves exactly the requested rows.
    const granted = await broker.grant(installed.manifest.id)
    if (!granted.ok) {
      err(`suckers: grant failed — ${granted.reason}`)
      return 3
    }
    saveState(broker, statePath, err)
    out(`audit ${JSON.stringify(granted.auditEvent)}`)
    out(
      `suckers: installed ${installed.manifest.id}@${installed.manifest.version} (${granted.grantedCount} grant rows)`
    )
    return 0
  }

  if (argv[0] === 'revoke') {
    const id = argv[1]
    if (id === undefined) {
      err(USAGE)
      return 2
    }
    const revoked = await broker.revoke(id)
    if (!revoked.ok) {
      err(`suckers: revoke refused — ${revoked.reason}`)
      return 3
    }
    saveState(broker, statePath, err)
    out(`audit ${JSON.stringify(revoked.auditEvent)}`)
    out(`suckers: revoked ${id}`)
    return 0
  }

  if (argv[0] === 'run') {
    const id = argv[1]
    const capability = argv[2]
    if (id === undefined || capability === undefined) {
      err(USAGE)
      return 2
    }
    let args: string[] = []
    const jsonFlag = argv.indexOf('--json-args')
    if (jsonFlag !== -1) {
      const raw = argv[jsonFlag + 1]
      if (raw === undefined) {
        err('suckers: --json-args needs a JSON array of strings')
        return 2
      }
      const parsed = parseJsonArgs(raw)
      if (!parsed.ok) {
        err(`suckers: ${parsed.reason}`)
        return 2
      }
      args = parsed.args
    }
    const result = await broker.invoke(id, capability, args)
    if (result.outcome === 'permissionDenied') {
      out(`audit ${JSON.stringify(result.auditEvent)}`)
      err(`suckers: DENIED (${result.because}) — ${id} may not invoke ${capability}`)
      return 3
    }
    if (result.outcome === 'upstream-failure') {
      out(`audit ${JSON.stringify(result.auditEvent)}`)
      err(`suckers: upstream-failure (retryable=${String(result.retryable)})`)
      return 1
    }
    if (result.process.stdout.length > 0) {
      out(result.process.stdout)
    }
    if (result.process.stderr.length > 0) {
      err(result.process.stderr)
    }
    out(`audit ${JSON.stringify(result.auditEvent)}`)
    out(
      `suckers: ${result.outcome} ${capability} exit=${result.process.exitCode ?? 'signal'} in ${result.process.durationMs}ms`
    )
    return 0
  }

  err(USAGE)
  return 2
}

if (process.argv[1]?.endsWith('suckers-cli.js') || process.argv[1]?.endsWith('suckers-cli.ts')) {
  void runSuckersCli({ argv: process.argv.slice(2) }).then((code) => {
    process.exitCode = code
  })
}
