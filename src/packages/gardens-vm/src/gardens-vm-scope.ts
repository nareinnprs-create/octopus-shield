export const GARDENS_SCOPE_ENV = 'OSHIELD_GARDENS_SCOPE'

export type GardensScope = ReadonlySet<string>

/** Deny-by-default: an unset or empty scope authorizes nothing. */
export const parseGardensScope = (raw: string | undefined): GardensScope => {
  const prefixes = new Set<string>()
  for (const token of (raw ?? '').split(',')) {
    const entry = token.trim()
    if (entry.length > 0) {
      prefixes.add(entry)
    }
  }
  return prefixes
}

export const vmNameInScope = (scope: GardensScope, name: string): boolean => {
  if (scope.size === 0) {
    return false
  }
  for (const prefix of scope) {
    if (name === prefix || name.startsWith(`${prefix}-`)) {
      return true
    }
  }
  return false
}

/** Denial reason for a per-VM operation, or undefined when the name is authorized. */
export const scopeRefusalReason = (
  scope: GardensScope,
  operation: string,
  name: string
): string | undefined => {
  if (scope.size === 0) {
    return `${operation} refused: ${GARDENS_SCOPE_ENV} is unset or empty (deny-by-default); set it to a VM-name prefix for this engagement`
  }
  if (!vmNameInScope(scope, name)) {
    return `${operation} refused: "${name}" is outside ${GARDENS_SCOPE_ENV} prefixes [${[...scope].join(', ')}]`
  }
  return undefined
}

export const scopeFromEnv = (env: Readonly<Record<string, string | undefined>>): GardensScope =>
  parseGardensScope(env[GARDENS_SCOPE_ENV])
