export function resolveDiagnosticBuildTokenEndpoint(): string | null {
  const endpoint =
    typeof OSHIELD_DIAGNOSTICS_TOKEN_URL !== 'undefined'
      ? OSHIELD_DIAGNOSTICS_TOKEN_URL
      : ((globalThis as { OSHIELD_DIAGNOSTICS_TOKEN_URL?: string | null })
          .OSHIELD_DIAGNOSTICS_TOKEN_URL ?? null)
  return typeof endpoint === 'string' && endpoint.length > 0 ? endpoint : null
}

export function resolveDiagnosticBuildIdentity(): 'stable' | 'rc' | null {
  const ident =
    typeof OSHIELD_BUILD_IDENTITY !== 'undefined'
      ? OSHIELD_BUILD_IDENTITY
      : ((globalThis as { OSHIELD_BUILD_IDENTITY?: 'stable' | 'rc' | null }).OSHIELD_BUILD_IDENTITY ??
        null)
  return ident === 'stable' || ident === 'rc' ? ident : null
}

export function resolveDiagnosticTokenEndpoint(): string | null {
  const buildEndpoint = resolveDiagnosticBuildTokenEndpoint()
  // Pin official builds to the support endpoint named by the UI, regardless of user environment.
  if (resolveDiagnosticBuildIdentity()) {
    return buildEndpoint
  }
  const fromEnv = process.env.OSHIELD_DIAGNOSTICS_TOKEN_URL
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv
  }
  return buildEndpoint
}

export function resolveDiagnosticShieldChannel(): 'stable' | 'rc' | 'dev' {
  const ident = resolveDiagnosticBuildIdentity()
  if (ident === 'stable' || ident === 'rc') {
    return ident
  }
  return 'dev'
}
