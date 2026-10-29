/**
 * Armory scope authorization: deny-by-default target allowlist. A tool run is
 * permitted only when every target argument resolves inside the configured
 * scope. Scope comes from OSHIELD_ARMORY_SCOPE (comma-separated hostnames,
 * IPs, or IPv4 CIDRs) — operator-configured, never defaulted to permissive.
 */

export type ArmoryScope = {
  exact: ReadonlySet<string>
  cidrs: readonly { network: number; prefix: number }[]
}

const EMPTY_SCOPE: ArmoryScope = { exact: new Set(), cidrs: [] }

const ipv4ToInt = (ip: string): number | undefined => {
  const parts = ip.split('.')
  if (parts.length !== 4) {
    return undefined
  }
  let value = 0
  for (const part of parts) {
    const octet = Number(part)
    if (!Number.isInteger(octet) || octet < 0 || octet > 255 || !/^\d+$/.test(part)) {
      return undefined
    }
    value = value * 256 + octet
  }
  return value
}

export const parseArmoryScope = (raw: string | undefined): ArmoryScope => {
  if (!raw || raw.trim().length === 0) {
    return EMPTY_SCOPE
  }
  const exact = new Set<string>()
  const cidrs: { network: number; prefix: number }[] = []
  for (const token of raw.split(',')) {
    const entry = token.trim().toLowerCase()
    if (entry.length === 0) {
      continue
    }
    if (entry.includes('/')) {
      const [ip, prefixRaw] = entry.split('/')
      const network = ipv4ToInt(ip)
      const prefix = Number(prefixRaw)
      if (network === undefined || !Number.isInteger(prefix) || prefix < 8 || prefix > 32) {
        continue
      }
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
      cidrs.push({ network: (network & mask) >>> 0, prefix })
    } else {
      exact.add(entry)
    }
  }
  return { exact, cidrs }
}

export const targetInScope = (scope: ArmoryScope, target: string): boolean => {
  const normalized = target.trim().toLowerCase()
  if (normalized.length === 0) {
    return false
  }
  if (scope.exact.has(normalized)) {
    return true
  }
  const ip = ipv4ToInt(normalized)
  if (ip === undefined) {
    return false
  }
  return scope.cidrs.some(({ network, prefix }) => {
    const mask = (0xffffffff << (32 - prefix)) >>> 0
    return ((ip & mask) >>> 0) === network
  })
}

export const targetsInScope = (scope: ArmoryScope, targets: readonly string[]): boolean =>
  targets.length > 0 && targets.every((target) => targetInScope(scope, target))

export const scopeFromEnv = (env: Readonly<Record<string, string | undefined>>): ArmoryScope =>
  parseArmoryScope(env.OSHIELD_ARMORY_SCOPE)
