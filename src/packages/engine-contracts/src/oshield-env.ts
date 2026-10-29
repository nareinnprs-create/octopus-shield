import type { EngineEndpointMap, EngineHttpEndpoint, NucleusInfraEndpointMap } from './engine-endpoints'
import {
  applyEngineEndpointOverrides,
  applyNucleusInfraEndpointOverrides,
  type EngineEndpointOverrides,
  type NucleusInfraEndpointOverrides
} from './engine-endpoint-overrides'

/** OSHIELD_* variable names; values live in process.env, never in this package. */
export const ENGINE_ENV_VAR_NAMES = {
  wazuhDashboardUrl: 'OSHIELD_WAZUH_DASHBOARD_URL',
  wazuhManagerApiUrl: 'OSHIELD_WAZUH_MANAGER_API_URL',
  wazuhAgentTcpPort: 'OSHIELD_WAZUH_AGENT_TCP_PORT',
  wazuhAgentEnrollmentPort: 'OSHIELD_WAZUH_AGENT_ENROLLMENT_PORT',
  mythicUiUrl: 'OSHIELD_MYTHIC_UI_URL',
  mythicPostgresHost: 'OSHIELD_MYTHIC_POSTGRES_HOST',
  mythicPostgresPort: 'OSHIELD_MYTHIC_POSTGRES_PORT',
  mythicRabbitmqHost: 'OSHIELD_MYTHIC_RABBITMQ_HOST',
  mythicRabbitmqPort: 'OSHIELD_MYTHIC_RABBITMQ_PORT',
  calderaUiUrl: 'OSHIELD_CALDERA_UI_URL',
  calderaApiUrl: 'OSHIELD_CALDERA_API_URL',
  nucleusNatsClientHost: 'OSHIELD_NATS_CLIENT_HOST',
  nucleusNatsClientPort: 'OSHIELD_NATS_CLIENT_PORT',
  nucleusNatsToken: 'OSHIELD_NATS_TOKEN',
  nucleusNatsMonitorUrl: 'OSHIELD_NATS_MONITOR_URL',
  nucleusNatsMonitorHost: 'OSHIELD_NATS_MONITOR_HOST',
  nucleusNatsMonitorPort: 'OSHIELD_NATS_MONITOR_PORT',
  nucleusPostgresHost: 'OSHIELD_PGVECTOR_POSTGRES_HOST',
  nucleusPostgresPort: 'OSHIELD_PGVECTOR_POSTGRES_PORT',
  nucleusRedisHost: 'OSHIELD_REDIS_HOST',
  nucleusRedisPort: 'OSHIELD_REDIS_PORT'
} as const

export type EngineEnvLike = Readonly<Record<string, string | undefined>>

const parseHttpEndpoint = (value: string | undefined): EngineHttpEndpoint | undefined => {
  if (!value) {
    return undefined
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined
  }
  const defaultPort = url.protocol === 'https:' ? 443 : 80
  return {
    protocol: url.protocol === 'https:' ? 'https' : 'http',
    host: url.hostname,
    port: url.port ? Number(url.port) : defaultPort
  }
}

const parsePort = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined
  }
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined
}

// Host chars restricted to what DNS names/IPv4/IPv6 literals legitimately contain;
// blocks path/fragment/userinfo smuggling when the host is interpolated into URLs.
const SAFE_HOST = /^[A-Za-z0-9._-]+$/

const parseHostPort = (env: EngineEnvLike, hostVar: string, portVar: string): Partial<{ host: string; port: number }> | undefined => {
  const rawHost = env[hostVar]
  const host = rawHost !== undefined && SAFE_HOST.test(rawHost) ? rawHost : undefined
  const port = parsePort(env[portVar])
  return host === undefined && port === undefined ? undefined : { host, port }
}

// NATS monitor transport is HTTP per the compose healthcheck (http://localhost:8222/healthz).
const parseNatsMonitor = (env: EngineEnvLike): Partial<EngineHttpEndpoint> | undefined => {
  const byUrl = parseHttpEndpoint(env[ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorUrl])
  if (byUrl) {
    return byUrl
  }
  return parseHostPort(env, ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorHost, ENGINE_ENV_VAR_NAMES.nucleusNatsMonitorPort)
}

/** Pure parser: engine endpoint overrides from an OSHIELD_* environment snapshot; never throws on bad values. */
export const parseEngineEndpointOverrides = (env: EngineEnvLike): EngineEndpointOverrides => {
  const wazuhDashboardUrl = parseHttpEndpoint(env[ENGINE_ENV_VAR_NAMES.wazuhDashboardUrl])
  const wazuhManagerApiUrl = parseHttpEndpoint(env[ENGINE_ENV_VAR_NAMES.wazuhManagerApiUrl])
  const mythicUiUrl = parseHttpEndpoint(env[ENGINE_ENV_VAR_NAMES.mythicUiUrl])
  const calderaUiUrl = parseHttpEndpoint(env[ENGINE_ENV_VAR_NAMES.calderaUiUrl])
  const calderaApiUrl = parseHttpEndpoint(env[ENGINE_ENV_VAR_NAMES.calderaApiUrl])
  return {
    wazuh: {
      dashboard: wazuhDashboardUrl,
      managerApi: wazuhManagerApiUrl,
      agentTcpPort: parsePort(env[ENGINE_ENV_VAR_NAMES.wazuhAgentTcpPort]),
      agentEnrollmentPort: parsePort(env[ENGINE_ENV_VAR_NAMES.wazuhAgentEnrollmentPort])
    },
    mythic: {
      ui: mythicUiUrl,
      postgres: parseHostPort(env, ENGINE_ENV_VAR_NAMES.mythicPostgresHost, ENGINE_ENV_VAR_NAMES.mythicPostgresPort),
      rabbitmq: parseHostPort(env, ENGINE_ENV_VAR_NAMES.mythicRabbitmqHost, ENGINE_ENV_VAR_NAMES.mythicRabbitmqPort)
    },
    caldera: { ui: calderaUiUrl, api: calderaApiUrl }
  }
}

export const parseNucleusInfraEndpointOverrides = (env: EngineEnvLike): NucleusInfraEndpointOverrides => ({
  natsClient: parseHostPort(env, ENGINE_ENV_VAR_NAMES.nucleusNatsClientHost, ENGINE_ENV_VAR_NAMES.nucleusNatsClientPort),
  natsMonitor: parseNatsMonitor(env),
  postgresPgvector: parseHostPort(env, ENGINE_ENV_VAR_NAMES.nucleusPostgresHost, ENGINE_ENV_VAR_NAMES.nucleusPostgresPort),
  redis: parseHostPort(env, ENGINE_ENV_VAR_NAMES.nucleusRedisHost, ENGINE_ENV_VAR_NAMES.nucleusRedisPort)
})

/** Convenience: resolved engine + nucleus config straight from an OSHIELD_* environment snapshot. */
export const engineConfigFromEnv = (env: EngineEnvLike): {
  engines: EngineEndpointMap
  nucleus: NucleusInfraEndpointMap
} => ({
  engines: applyEngineEndpointOverrides(parseEngineEndpointOverrides(env)),
  nucleus: applyNucleusInfraEndpointOverrides(parseNucleusInfraEndpointOverrides(env))
})
