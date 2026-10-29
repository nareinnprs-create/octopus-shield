#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { EngineEnvLike } from '@shield/engine-contracts'
import type { AuditEvent } from '@shield/access/audit-chain'
import { sha256EntryHashFn } from '@shield/access/audit-chain-sha256'
import { createPostgresAuditSink, type PostgresAuditSink } from '@shield/audit-store'
import { runProcess } from '@shield/process-host'
import { armoryRunAuditEvent } from './armory-audit'
import { buildArgv, runArmoryTool } from './tool-runner'
import { defaultInventoryPaths, loadToolInventory } from './inventory'
import type { ArmoryToolDescriptor } from './tool-registry'
import { scopeFromEnv } from './tool-scope'

export type ArmoryCliOptions = {
  argv: readonly string[]
  env: EngineEnvLike
  /** Ring inventory paths; defaults to %TEMP%\opencode\armory\<ring>.json set. */
  inventoryPaths?: readonly string[]
  out?: (line: string) => void
  err?: (line: string) => void
}

let pgAuditSink: PostgresAuditSink | null = null

/** Best-effort nucleus ledger persistence (OSHIELD_AUDIT_PG=1); the printed event stays authoritative on failure. */
async function persistAuditEventToNucleus(
  event: AuditEvent,
  err: (line: string) => void
): Promise<void> {
  if (process.env.OSHIELD_AUDIT_PG !== '1') {
    return
  }
  try {
    pgAuditSink ??= createPostgresAuditSink({
      host: '127.0.0.1',
      port: 5435,
      database: 'octopusshield',
      user: 'octopus',
      passwordFile: process.env.OSHIELD_NUCLEUS_PG_PASSWORD_FILE ?? resolve('infra', '.pg_password')
    })
    await pgAuditSink.append(event, sha256EntryHashFn)
  } catch (error) {
    err(
      `armory: nucleus audit append failed (non-fatal): ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

export /** Local run-history JSONL (machine-local; the Postgres chain is the tamper-evident system of record). */
function appendRunHistory(
  record: { toolId: string; argv: readonly string[]; targets: readonly string[]; exitCode: number | null; timedOut: boolean; durationMs: number },
  err: (line: string) => void
): void {
  try {
    const file =
      process.env.OSHIELD_ARMORY_HISTORY ?? 'C:\\Users\\manag\\tools\\armory\\history\\runs.jsonl'
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(
      file,
      JSON.stringify({ ts: Date.now(), tool: record.toolId, argv: record.argv, targets: record.targets, exit: record.exitCode, timedOut: record.timedOut, ms: record.durationMs }) + '\n'
    )
  } catch (error) {
    err(`armory: run-history append failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function runArmoryCli(options: ArmoryCliOptions): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`))
  const err = options.err ?? ((line: string) => process.stderr.write(`${line}\n`))
  const argv = options.argv
  const tools = loadToolInventory(options.inventoryPaths ?? defaultInventoryPaths())

  if (argv[0] === 'list') {
    if (!argv.includes('--fast')) {
      err('live health sweep (use --fast to skip)...')
      await runHealth(out, err)
    }
    for (const tool of tools) {
      out(
        `${tool.status.padEnd(18)} ${tool.runtime.padEnd(6)} ${tool.scopeClass.padEnd(17)} ${tool.id}`
      )
    }
    out(`${tools.length} tools`)
    return 0
  }

  if (argv[0] === 'run') {
    const toolId = argv[1]
    const tool = tools.find((candidate: ArmoryToolDescriptor) => candidate.id === toolId)
    if (tool === undefined) {
      err(`armory: unknown or not-installed tool: ${toolId ?? '(none given)'}`)
      return 2
    }
    const split = argv.indexOf('--')
    if (split === -1) {
      err('armory: run requires -- <args...> with target arguments inside')
      return 2
    }
    const scope = scopeFromEnv(options.env)
    const exploitAuthorized = options.env.OSHIELD_ARMORY_EXPLOIT_AUTHORIZED === '1'
    const targetsFlag = argv.find((raw) => raw.startsWith('--targets='))
    const declared = targetsFlag
      ?.slice('--targets='.length)
      .split(',')
      .filter((t) => t.length > 0)
    const args = argv.slice(split + 1)
    const targets = declared ?? args.filter((raw) => !raw.startsWith('-'))
    const result = await runArmoryTool(tool, {
      args,
      targets,
      scope,
      exploitAuthorized
    })
    if (!result.ok) {
      err(`armory: DENIED — ${result.reason}`)
      return 3
    }
    if (result.record.stdout.length > 0) {
      out(result.record.stdout)
    }
    if (result.record.stderr.length > 0) {
      err(result.record.stderr)
    }
    const auditEvent = armoryRunAuditEvent(result.record)
    out(`audit ${JSON.stringify(auditEvent)}`)
    await persistAuditEventToNucleus(auditEvent, err)
    appendRunHistory(result.record, err)
    out(
      `armory: ${tool.id} exit=${result.record.exitCode ?? 'timeout'} in ${result.record.durationMs}ms`
    )
    return result.record.exitCode === 0 ? 0 : 1
  }

  async function runHealth(out: (line: string) => void, err: (line: string) => void): Promise<void> {
    err('checking every tool (version smoke, 8s cap each)...')
    let healthy = 0
    let checkable = 0
    for (const tool of tools) {
      if (tool.status !== 'ok') {
        out(`skip    ${tool.id} — status: ${tool.status}`)
        continue
      }
      checkable += 1
      const argv = buildArgv(tool, [...tool.versionArgv])
      if (!argv.ok) {
        err(`${tool.id}: DENIED — ${argv.reason}`)
        continue
      }
      let run: Awaited<ReturnType<typeof runProcess>>
      try {
        run = await runProcess({
          program: argv.argv[0],
          args: argv.argv.slice(1),
          timeoutMs: 8_000
        })
      } catch (error) {
        err(
          `${tool.id}: SPAWN-FAIL — ${error instanceof Error ? error.message.slice(0, 80) : String(error)}`
        )
        continue
      }
      const ok = run.code === 0 || run.stdout.length > 0
      if (ok) {
        healthy += 1
      }
      out(
        `${ok ? 'ok      ' : 'UNHEALTHY'} ${tool.id} — ${run.stdout.split('\n')[0].slice(0, 70) || run.stderr.split('\n')[0].slice(0, 70)}`
      )
    }
    out(`${healthy}/${checkable} healthy (${tools.length - checkable} skipped by status)`)
  }

  if (argv[0] === 'health') {
    await runHealth(out, err)
    return 0
  }

  err('usage: armory list [--live] | health | run <tool-id> [--targets=<t,t,...>] -- [args...]')
  return 2
}

if (process.argv[1]?.endsWith('armory-cli.js') || process.argv[1]?.endsWith('armory-cli.ts')) {
  void runArmoryCli({ argv: process.argv.slice(2), env: process.env }).then((code) => {
    process.exitCode = code
  })
}
