#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { sha256EntryHashFn } from '@shield/access/audit-chain-sha256'
import { Client } from 'pg'

import {
  AUDIT_VERIFY_DEFAULT_LIMIT,
  verifyPersistedChain,
  type PersistedChainVerification,
  type VerifyClientLike
} from './audit-verify'

export const AUDIT_VERIFY_EXIT_VERIFIED = 0
export const AUDIT_VERIFY_EXIT_BROKEN = 1
export const AUDIT_VERIFY_EXIT_EMPTY = 2

const NUCLEUS_PG_HOST = '127.0.0.1'
const NUCLEUS_PG_PORT = 5435
const NUCLEUS_PG_DATABASE = 'octopusshield'
const NUCLEUS_PG_USER = 'octopus'

export type AuditVerifyCliOptions = {
  argv: readonly string[]
  out?: (line: string) => void
  err?: (line: string) => void
  /** Test seam: supplies the client instead of constructing a nucleus pg Client. */
  createClient?: () => VerifyClientLike & { close(): Promise<void> }
}

export type ParsedAuditVerifyArgs = {
  limit: number
  json: boolean
}

export function parseAuditVerifyArgs(argv: readonly string[]): ParsedAuditVerifyArgs | null {
  let limit = AUDIT_VERIFY_DEFAULT_LIMIT
  let json = false
  for (let index = 0; index < argv.length; index = index + 1) {
    const arg = argv[index]
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg === '--limit' || arg.startsWith('--limit=')) {
      const raw = arg === '--limit' ? argv[index + 1] : arg.slice('--limit='.length)
      if (arg === '--limit') {
        index += 1
      }
      const parsed = Number(raw)
      if (!Number.isSafeInteger(parsed) || parsed < 1) {
        return null
      }
      limit = parsed
      continue
    }
    return null
  }
  return { limit, json }
}

export function auditVerifyVerdictLines(
  verification: PersistedChainVerification,
  limit: number
): string[] {
  const lines = [
    `audit-verify: nucleus audit_events @ ${NUCLEUS_PG_HOST}:${NUCLEUS_PG_PORT}/${NUCLEUS_PG_DATABASE}`,
    `rows checked: ${verification.checked} (limit ${limit})`,
    `genesis present: ${verification.genesisPresent ? 'yes' : 'no'}`
  ]
  if (verification.checked === 0) {
    lines.push('EMPTY LEDGER — nothing to verify')
    return lines
  }
  const brk = verification.firstBroken
  if (brk === null) {
    lines.push(
      `chain OK — ${verification.checked} entries verified, tail ${verification.tailEntryHash}`
    )
    return lines
  }
  lines.push(
    `CHAIN BREAK at index ${brk.index}${brk.id === null ? '' : ` (id ${brk.id})`}`,
    `reason: ${brk.reason}`
  )
  if (brk.kind === 'entry_hash_mismatch') {
    lines.push(
      `stored entry_hash:   ${brk.storedEntryHash}`,
      `recomputed expected: ${brk.expectedEntryHash}`
    )
  } else if (brk.kind === 'prev_hash_mismatch') {
    lines.push(
      `stored prev_hash:   ${brk.storedPrevHash}`,
      `expected prev_hash: ${brk.expectedPrevHash}`
    )
  } else {
    lines.push(`stored entry_hash: ${brk.storedEntryHash}`)
  }
  return lines
}

/** Nucleus pg Client adapted to VerifyClientLike; password comes from the secret file and is never logged. */
function createNucleusClient(
  stderr: (line: string) => void
): (VerifyClientLike & { close(): Promise<void> }) | null {
  const passwordFile =
    process.env.OSHIELD_NUCLEUS_PG_PASSWORD_FILE ?? resolve('infra', '.pg_password')
  try {
    const password = readFileSync(passwordFile, 'utf8').trim()
    const client = new Client({
      host: NUCLEUS_PG_HOST,
      port: NUCLEUS_PG_PORT,
      database: NUCLEUS_PG_DATABASE,
      user: NUCLEUS_PG_USER,
      password
    })
    // Explicit connect on first query: pg's implicit-connect query path stalls on the nucleus socket.
    let connected = false
    return {
      query: async (text, values) => {
        if (!connected) {
          await client.connect()
          connected = true
        }
        return client.query(text, values === undefined ? undefined : [...values])
      },
      close: async () => {
        if (!connected) {
          return
        }
        connected = false
        await client.end()
      }
    }
  } catch (error) {
    stderr(
      `audit-verify: cannot read nucleus pg password file (${passwordFile}): ${
        error instanceof Error ? error.message : String(error)
      }`
    )
    return null
  }
}

/** audit-verify [--limit N] [--json]; exit 0 verified / 1 broken / 2 empty. Never prints payloads or the password. */
export async function runAuditVerifyCli(options: AuditVerifyCliOptions): Promise<number> {
  const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`))
  const stderr = options.err ?? ((line: string) => process.stderr.write(`${line}\n`))
  const parsed = parseAuditVerifyArgs(options.argv)
  if (parsed === null) {
    stderr('usage: audit-verify [--limit N] [--json]')
    return 2
  }
  const client = options.createClient?.() ?? createNucleusClient(stderr)
  if (client === null) {
    return AUDIT_VERIFY_EXIT_BROKEN
  }
  try {
    const verification = await verifyPersistedChain(client, sha256EntryHashFn, {
      limit: parsed.limit
    })
    if (parsed.json) {
      out(JSON.stringify(verification, null, 2))
    } else {
      for (const line of auditVerifyVerdictLines(verification, parsed.limit)) {
        out(line)
      }
    }
    if (verification.checked === 0) {
      return AUDIT_VERIFY_EXIT_EMPTY
    }
    return verification.ok ? AUDIT_VERIFY_EXIT_VERIFIED : AUDIT_VERIFY_EXIT_BROKEN
  } catch (error) {
    stderr(
      `audit-verify: verification failed: ${error instanceof Error ? error.message : String(error)}`
    )
    return AUDIT_VERIFY_EXIT_BROKEN
  } finally {
    await client.close()
  }
}

if (
  process.argv[1]?.endsWith('audit-verify-cli.js') ||
  process.argv[1]?.endsWith('audit-verify-cli.ts')
) {
  void runAuditVerifyCli({ argv: process.argv.slice(2) }).then((code) => {
    process.exitCode = code
  })
}
