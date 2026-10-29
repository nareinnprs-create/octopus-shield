import { createHash } from 'node:crypto'

import { AUDIT_HASH_DOMAIN, AUDIT_HASH_FIELD_SEPARATOR, type EntryHashFn } from './audit-chain'

/**
 * Node-side EntryHashFn using the repo's standard `node:crypto` import style
 * (cf. src/shared/agent-hook-spool.ts, src/main/acp/acp-subagents.ts). The
 * composition matches the ENTRY_HASH definition block in infra/db/audit.sql:
 * domain tag, then previous hash, then the canonical event JSON, all
 * separated by 0x1F.
 */
export const sha256EntryHashFn: EntryHashFn = (
  previousHash: string,
  canonicalEventJson: string
): string => {
  return createHash('sha256')
    .update(AUDIT_HASH_DOMAIN, 'utf8')
    .update(AUDIT_HASH_FIELD_SEPARATOR, 'utf8')
    .update(previousHash, 'utf8')
    .update(AUDIT_HASH_FIELD_SEPARATOR, 'utf8')
    .update(canonicalEventJson, 'utf8')
    .digest('hex')
}
