import { ENGINE_ENV_VAR_NAMES } from '@shield/engine-contracts/oshield-env'

export type EngineFabricConfig = {
  wazuhUrl: string
  wazuhApiToken: string
  calderaUrl: string
  calderaApiKey: string
  mythicUrl: string
  mythicApiToken: string
}

/**
 * Live deployment defaults (operator-verified engine port map):
 * - Wazuh manager API 55000: engines/wazuh-docker/single-node/docker-compose.yml:29.
 * - Mythic HTTPS 7443: engines/mythic/nginx-docker/config/conf.d/services.conf:2-3 (nginx `listen ... 7443 ssl`).
 * - Caldera plain-API 8890: Caldera has NO TLS contact in its 5.0 source (engines/caldera/app/contacts/*
 *   has no tls class; no tls refs in server.py) and the live 18443 handshake is dead (upstream compose
 *   port 8443 is a no-op leftover). A TLS front is a later reverse-proxy job; override only
 *   via OSHIELD_CALDERA_API_URL.
 */
export const DEFAULT_ENGINE_FABRIC = {
  wazuhUrl: 'https://localhost:55000',
  calderaUrl: 'http://localhost:8890',
  mythicUrl: 'https://localhost:7443'
} as const

/**
 * Single source of URL vocabulary is @shield/engine-contracts
 * ENGINE_ENV_VAR_NAMES; this package must not print parallel literals.
 * Invalid overrides here are a loud startup failure (the contracts-side
 * parser stays total; this one throws) — silent default fallbacks let a
 * typo'd env var silently retarget an engine.
 */
export function readEngineFabricConfig(
  env: Readonly<Record<string, string | undefined>> = process.env
): EngineFabricConfig {
  return {
    wazuhUrl: resolveEngineUrl(env, ENGINE_ENV_VAR_NAMES.wazuhManagerApiUrl, DEFAULT_ENGINE_FABRIC.wazuhUrl),
    wazuhApiToken: env.OSHIELD_WAZUH_API_TOKEN ?? '',
    calderaUrl: resolveEngineUrl(env, ENGINE_ENV_VAR_NAMES.calderaApiUrl, DEFAULT_ENGINE_FABRIC.calderaUrl),
    calderaApiKey: env.OSHIELD_CALDERA_API_KEY ?? '',
    mythicUrl: resolveEngineUrl(env, ENGINE_ENV_VAR_NAMES.mythicUiUrl, DEFAULT_ENGINE_FABRIC.mythicUrl),
    mythicApiToken: env.OSHIELD_MYTHIC_API_TOKEN ?? ''
  }
}

/** engine APIs are TLS-only except localhost, where http is a dev convenience. */
export function resolveEngineUrl(
  env: Readonly<Record<string, string | undefined>>,
  varName: string,
  fallback: string
): string {
  const raw = env[varName]
  if (raw === undefined) {
    return fallback
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`${varName} is not a valid URL: ${JSON.stringify(raw)}`)
  }
  if (url.hostname.length === 0) {
    throw new Error(`${varName} is missing a hostname: ${JSON.stringify(raw)}`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHost(url.hostname))) {
    throw new Error(
      `${varName} must be https:// (or http:// on localhost), got: ${url.protocol}${url.host}`
    )
  }
  return raw
}

function isLocalHost(hostname: string): boolean {
  // URL.hostname keeps brackets on IPv6 literals ([::1]) — strip before compare.
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1'
}
