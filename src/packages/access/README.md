# Shield access

Pure RBAC/MFA domain model, deny-wins permission evaluation, and the
append-only audit hash chain. It has no runtime npm dependencies, no
Electron imports, and no native addons. Node crypto appears only in the
optional `audit-chain-sha256` subpath, so web targets substitute their own
hash function.

Schema lives in `infra/db/audit.sql` and `infra/db/rbac.sql`; the TS types
here mirror those tables (`audit_events`, `roles`, `role_permissions`,
`users`, `user_roles`, `tentacle_principals`, `sessions`, `mfa_factors`).

Public exports:

- `@shield/access` — `permission-domain.ts`: `Principal`, `Role`,
  `Permission`, `Session`, `MfaFactor`, `PrincipalKind`, `RoleKind`,
  `MfaMethod`, plus pure `isSessionExpired` / `sessionRequiresMfa`.
- `@shield/access/permission-evaluate` — pure deny-wins `evaluate()` over
  declarative grant lists (exact `resourceKind`/`action` match; deny beats
  allow; no grant is default-deny) and `collectRoleGrants` to merge a
  principal's roles.
- `@shield/access/audit-chain` — pure `AuditChain` builder: appends take an
  injected `hash(previousHash, canonicalEventJson) => entryHash` function
  (`EntryHashFn`), never a crypto import, plus `stableJson` canonicalization
  (sorted keys, no `undefined` members), `verifyLedger`, and `toCheckpoint`
  for an off-chain parity pin.
- `@shield/access/audit-chain-sha256` — the Node `node:crypto` `EntryHashFn`
  (`sha256EntryHashFn`) whose composition matches the ENTRY_HASH definition
  documented at the top of `infra/db/audit.sql`.

Hash composition contract: `@shield/access` exports
`AUDIT_HASH_DOMAIN` and the `0x1F` field separators; both sides must change
together. Postgres `jsonb::text` re-orders keys, so hash verification
recomputes app-side rather than in SQL — flagged TODO(verify) in audit.sql.

From the repository root:

```sh
pnpm --filter @shield/access typecheck
```

Build/test wiring (dist outputs, vitest) lands with the first consumer;
this package ships source-first under the `shield-source` condition
exactly like `@shield/process-host` (see its `package.json` exports).
