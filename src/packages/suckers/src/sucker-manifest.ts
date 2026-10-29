/**
 * Sucker manifest parsing per docs/sucker-contract.md §1 (v0.1).
 * Hand-rolled validators (no schema deps): unknown fields reject, byte and
 * structural budgets reject, and every accepted shape is immutable once
 * parsed. `permissions` are requests, not facts — authority materializes
 * only through SuckerBroker.grant.
 */

export const SUCKER_KINDS = ['threat-intel', 'enrichment-feed', 'reporting-sink'] as const
export type SuckerKind = (typeof SUCKER_KINDS)[number]

/** Shed isolation tiers, strongest first (contract §2; names per §7). */
export const SUCKER_SHED_TIERS = ['shed-isolated', 'shed-scratch', 'shed-trusted'] as const
export type SuckerShedTier = (typeof SUCKER_SHED_TIERS)[number]

/**
 * resourceKind under which the broker files capability grants, so Sucker
 * capability authority lives in one RBAC namespace evaluated by
 * @shield/access evaluate() like every other (resourceKind, action) fact.
 */
export const SUCKER_CAPABILITY_RESOURCE_KIND = 'sucker.capability'

export type SuckerPermissionRequest = {
  resourceKind: string
  action: string
}

export type SuckerEgressDeclaration = {
  capability: string
  purpose: string
}

export type SuckerPublisher = {
  id: string
  signingKeyId: string
}

export type SuckerManifest = {
  id: string
  version: string
  kind: SuckerKind
  permissions: readonly SuckerPermissionRequest[]
  isolation: { tier: SuckerShedTier }
  egress: readonly SuckerEgressDeclaration[]
  publisher: SuckerPublisher
}

export type SuckerManifestParseResult =
  | { ok: true; manifest: SuckerManifest }
  | { ok: false; reason: string }

export type SuckerManifestParseOptions = {
  /**
   * Owner-curated resource-kind registry (contract §1 TODO(verify)). When
   * provided, requested resourceKinds outside the set reject at parse time;
   * until the registry lands, structure-only validation applies.
   */
  resourceKinds?: ReadonlySet<string>
}

const SUCKER_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const CAPABILITY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

export const MAX_MANIFEST_JSON_BYTES = 65_536
const MAX_ID_LENGTH = 64
const MAX_FIELD_LENGTH = 256
const MAX_PERMISSIONS = 128
const MAX_EGRESS = 32

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === null || prototype === Object.prototype
}

const isPlainArray = (value: unknown): value is readonly unknown[] => Array.isArray(value)

const fail = (reason: string): SuckerManifestParseResult => ({ ok: false, reason })

function requireString(
  record: Record<string, unknown>,
  field: string,
  pattern: RegExp = TOKEN_PATTERN
): string | null {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_FIELD_LENGTH) {
    return null
  }
  return pattern.test(value) ? value : null
}

/** Rejects key sets outside `allowed` — unknown fields reject per contract §1. */
function requireExactKeys(
  record: Record<string, unknown>,
  allowed: readonly string[]
): string | null {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      return `unknown field: ${key}`
    }
  }
  return null
}

function parsePermissions(
  value: unknown,
  options: SuckerManifestParseOptions
): { ok: true; permissions: readonly SuckerPermissionRequest[] } | { ok: false; reason: string } {
  if (!isPlainArray(value)) {
    return { ok: false, reason: 'permissions must be an array' }
  }
  if (value.length > MAX_PERMISSIONS) {
    return { ok: false, reason: `permissions exceeds ${MAX_PERMISSIONS} rows` }
  }
  const permissions: SuckerPermissionRequest[] = []
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      return { ok: false, reason: 'each permission must be an object' }
    }
    const unknownKey = requireExactKeys(entry, ['resourceKind', 'action'])
    if (unknownKey !== null) {
      return { ok: false, reason: `permissions entry: ${unknownKey}` }
    }
    const resourceKind = requireString(entry, 'resourceKind')
    const action = requireString(entry, 'action')
    if (resourceKind === null || action === null) {
      return {
        ok: false,
        reason: 'permissions entry needs non-empty resourceKind and action (max 256 chars)'
      }
    }
    if (
      options.resourceKinds !== undefined &&
      !options.resourceKinds.has(resourceKind.toLowerCase())
    ) {
      return { ok: false, reason: `resourceKind outside the Shield registry: ${resourceKind}` }
    }
    permissions.push({ resourceKind, action })
  }
  if (permissions.length === 0) {
    return { ok: false, reason: 'permissions must declare at least one requested row' }
  }
  return { ok: true, permissions }
}

function parseEgress(
  value: unknown
): { ok: true; egress: readonly SuckerEgressDeclaration[] } | { ok: false; reason: string } {
  if (!isPlainArray(value)) {
    return { ok: false, reason: 'egress must be an array' }
  }
  if (value.length > MAX_EGRESS) {
    return { ok: false, reason: `egress exceeds ${MAX_EGRESS} declarations` }
  }
  const egress: SuckerEgressDeclaration[] = []
  for (const entry of value) {
    if (!isPlainObject(entry)) {
      return { ok: false, reason: 'each egress entry must be an object' }
    }
    const unknownKey = requireExactKeys(entry, ['capability', 'purpose'])
    if (unknownKey !== null) {
      return { ok: false, reason: `egress entry: ${unknownKey}` }
    }
    const capability = requireString(entry, 'capability', CAPABILITY_PATTERN)
    const purpose = requireString(entry, 'purpose', /^[\x20-\x7e]+$/)
    if (capability === null || purpose === null) {
      return {
        ok: false,
        reason:
          'egress entry needs a lowercase capability name and single-line printable purpose (max 256 chars)'
      }
    }
    egress.push({ capability, purpose })
  }
  return { ok: true, egress }
}

function parsePublisher(
  value: unknown
): { ok: true; publisher: SuckerPublisher } | { ok: false; reason: string } {
  if (!isPlainObject(value)) {
    return { ok: false, reason: 'publisher must be an object' }
  }
  const unknownKey = requireExactKeys(value, ['id', 'signingKeyId'])
  if (unknownKey !== null) {
    return { ok: false, reason: `publisher: ${unknownKey}` }
  }
  const id = requireString(value, 'id')
  const signingKeyId = requireString(value, 'signingKeyId')
  if (id === null || signingKeyId === null) {
    return { ok: false, reason: 'publisher needs non-empty id and signingKeyId (max 256 chars)' }
  }
  return { ok: true, publisher: { id, signingKeyId } }
}

/**
 * Parses an unknown JSON-decoded value into a SuckerManifest. Deny-by-default:
 * anything not exactly the contract §1 shape (including `custom` kind and
 * retired shed-t0/t1/t2 labels) rejects with a precise reason.
 */
export function parseSuckerManifest(
  input: unknown,
  options: SuckerManifestParseOptions = {}
): SuckerManifestParseResult {
  if (!isPlainObject(input)) {
    return fail('manifest must be a JSON object')
  }
  const unknownKey = requireExactKeys(input, [
    'id',
    'version',
    'kind',
    'permissions',
    'isolation',
    'egress',
    'publisher'
  ])
  if (unknownKey !== null) {
    return fail(unknownKey)
  }
  const id = requireString(input, 'id', SUCKER_ID_PATTERN)
  if (id === null) {
    return fail(`id must match ${SUCKER_ID_PATTERN.source} (slug, max ${MAX_ID_LENGTH} chars)`)
  }
  if (id.length > MAX_ID_LENGTH) {
    return fail(`id exceeds ${MAX_ID_LENGTH} chars`)
  }
  const version = requireString(input, 'version', SEMVER_PATTERN)
  if (version === null) {
    return fail('version must be a semver string (major.minor.patch[-prerelease])')
  }
  const kind = SUCKER_KINDS.find((candidate) => candidate === input.kind)
  if (kind === undefined) {
    return fail(`kind must be one of: ${SUCKER_KINDS.join(', ')}`)
  }
  const isolation = input.isolation
  if (!isPlainObject(isolation)) {
    return fail('isolation must be an object')
  }
  const isolationKeys = requireExactKeys(isolation, ['tier'])
  if (isolationKeys !== null) {
    return fail(`isolation: ${isolationKeys}`)
  }
  const tier = SUCKER_SHED_TIERS.find((candidate) => candidate === isolation.tier)
  if (tier === undefined) {
    return fail(`isolation.tier must be one of: ${SUCKER_SHED_TIERS.join(', ')}`)
  }
  const permissions = parsePermissions(input.permissions, options)
  if (!permissions.ok) {
    return permissions
  }
  const egress = parseEgress(input.egress)
  if (!egress.ok) {
    return egress
  }
  const publisher = parsePublisher(input.publisher)
  if (!publisher.ok) {
    return publisher
  }
  return {
    ok: true,
    manifest: {
      id,
      version,
      kind,
      permissions: permissions.permissions,
      isolation: { tier },
      egress: egress.egress,
      publisher: publisher.publisher
    }
  }
}

/** Byte-budgeted JSON entry point: oversize rejects before any parsing work. */
export function parseSuckerManifestJson(
  text: string,
  options: SuckerManifestParseOptions = {}
): SuckerManifestParseResult {
  const byteLength = Buffer.byteLength(text, 'utf8')
  if (byteLength > MAX_MANIFEST_JSON_BYTES) {
    return fail(`manifest exceeds ${MAX_MANIFEST_JSON_BYTES} bytes (got ${byteLength})`)
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(text) as unknown
  } catch {
    return fail('manifest is not valid JSON')
  }
  return parseSuckerManifest(decoded, options)
}
