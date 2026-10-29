import {
  ENGINE_ENDPOINTS_DEFAULT,
  NUCLEUS_INFRA_ENDPOINTS_DEFAULT,
  type EngineEndpointMap,
  type EngineHttpEndpoint,
  type EngineTcpEndpoint,
  type NucleusInfraEndpointMap
} from './engine-endpoints'

export type EngineEndpointOverrides = {
  wazuh?: {
    dashboard?: Partial<EngineHttpEndpoint>
    managerApi?: Partial<EngineHttpEndpoint>
    agentTcpPort?: number
    agentEnrollmentPort?: number
  }
  mythic?: {
    ui?: Partial<EngineHttpEndpoint>
    postgres?: Partial<EngineTcpEndpoint>
    rabbitmq?: Partial<EngineTcpEndpoint>
  }
  caldera?: {
    ui?: Partial<EngineHttpEndpoint>
    api?: Partial<EngineHttpEndpoint>
  }
}

export type NucleusInfraEndpointOverrides = {
  natsClient?: Partial<EngineTcpEndpoint>
  natsMonitor?: Partial<EngineHttpEndpoint>
  postgresPgvector?: Partial<EngineTcpEndpoint>
  redis?: Partial<EngineTcpEndpoint>
}

const replaceEndpoint = <T extends object>(base: T, override: Partial<T> | undefined): T => {
  if (!override) {
    return base
  }
  const merged: T = { ...base }
  for (const [field, value] of Object.entries(override)) {
    if (value !== undefined) {
      // SAFETY: field keys come from Object.entries of Partial<T>, so only declared base fields are written.
      ;(merged as Record<string, unknown>)[field] = value
    }
  }
  return merged
}

/** Composes resolved engine endpoints from the live defaults plus sparse overrides; undefined fields keep defaults. */
export const applyEngineEndpointOverrides = (
  overrides: EngineEndpointOverrides
): EngineEndpointMap => ({
  wazuh: {
    dashboard: replaceEndpoint(ENGINE_ENDPOINTS_DEFAULT.wazuh.dashboard, overrides.wazuh?.dashboard),
    managerApi: replaceEndpoint(ENGINE_ENDPOINTS_DEFAULT.wazuh.managerApi, overrides.wazuh?.managerApi),
    agentTcpPort: overrides.wazuh?.agentTcpPort ?? ENGINE_ENDPOINTS_DEFAULT.wazuh.agentTcpPort,
    agentEnrollmentPort:
      overrides.wazuh?.agentEnrollmentPort ?? ENGINE_ENDPOINTS_DEFAULT.wazuh.agentEnrollmentPort
  },
  mythic: {
    ui: replaceEndpoint(ENGINE_ENDPOINTS_DEFAULT.mythic.ui, overrides.mythic?.ui),
    postgres: replaceEndpoint(ENGINE_ENDPOINTS_DEFAULT.mythic.postgres, overrides.mythic?.postgres),
    rabbitmq: replaceEndpoint(ENGINE_ENDPOINTS_DEFAULT.mythic.rabbitmq, overrides.mythic?.rabbitmq)
  },
  caldera: {
    ui: replaceEndpoint(ENGINE_ENDPOINTS_DEFAULT.caldera.ui, overrides.caldera?.ui),
    api: replaceEndpoint(ENGINE_ENDPOINTS_DEFAULT.caldera.api, overrides.caldera?.api)
  }
})

export const applyNucleusInfraEndpointOverrides = (
  overrides: NucleusInfraEndpointOverrides
): NucleusInfraEndpointMap => ({
  natsClient: replaceEndpoint(NUCLEUS_INFRA_ENDPOINTS_DEFAULT.natsClient, overrides.natsClient),
  natsMonitor: replaceEndpoint(NUCLEUS_INFRA_ENDPOINTS_DEFAULT.natsMonitor, overrides.natsMonitor),
  postgresPgvector: replaceEndpoint(
    NUCLEUS_INFRA_ENDPOINTS_DEFAULT.postgresPgvector,
    overrides.postgresPgvector
  ),
  redis: replaceEndpoint(NUCLEUS_INFRA_ENDPOINTS_DEFAULT.redis, overrides.redis)
})
