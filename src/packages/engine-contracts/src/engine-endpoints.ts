/** Shape of a host-published HTTP endpoint (wazuh dashboard/manager API, mythic UI, caldera UI/API, NATS monitor). */
export type EngineHttpEndpoint = {
  protocol: 'http' | 'https'
  host: string
  port: number
}

/** Shape of a bare TCP/Postgres-style endpoint (mythic postgres/rabbitmq, nucleus data plane). */
export type EngineTcpEndpoint = {
  host: string
  port: number
}

export type EngineId = 'wazuh' | 'mythic' | 'caldera'

export type EngineEndpointMap = {
  wazuh: {
    /** https://localhost:443 */
    dashboard: EngineHttpEndpoint
    /** manager API on 55000 */
    managerApi: EngineHttpEndpoint
    /** agent TCP channel 1514, enrollment 1515 */
    agentTcpPort: number
    agentEnrollmentPort: number
  }
  mythic: {
    ui: EngineHttpEndpoint
    postgres: EngineTcpEndpoint
    rabbitmq: EngineTcpEndpoint
  }
  caldera: {
    ui: EngineHttpEndpoint
    api: EngineHttpEndpoint
  }
}

/** Cross-engine first-party substrate from infra/docker-compose.nucleus.yml. */
export type NucleusInfraEndpointMap = {
  natsClient: EngineTcpEndpoint
  /** NATS HTTP monitor serving /healthz */
  natsMonitor: EngineHttpEndpoint
  postgresPgvector: EngineTcpEndpoint
  redis: EngineTcpEndpoint
}

export const ENGINE_ENDPOINTS_DEFAULT = {
  wazuh: {
    dashboard: { protocol: 'https', host: 'localhost', port: 443 },
    managerApi: { protocol: 'https', host: 'localhost', port: 55000 },
    agentTcpPort: 1514,
    agentEnrollmentPort: 1515
  },
  mythic: {
    ui: { protocol: 'https', host: 'localhost', port: 7443 },
    postgres: { host: 'localhost', port: 5436 },
    // RabbitMQ is Mythic compose-internal (not host-published); override via OSHIELD_MYTHIC_RABBITMQ_HOST.
    rabbitmq: { host: 'localhost', port: 5672 }
  },
  caldera: {
    ui: { protocol: 'http', host: 'localhost', port: 8890 },
    // No TLS contact exists in Caldera 5.0 source (engines/caldera/app/contacts/* has no tls class;
    // no tls refs in server.py) and the live 18443 handshake is dead — the upstream compose port is
    // a no-op leftover. Plain http 8890 (container serves 8888, host-published 8890). TLS fronting is
    // a later reverse-proxy job; operators needing a TLS front override via OSHIELD_CALDERA_API_URL.
    api: { protocol: 'http', host: 'localhost', port: 8890 }
  }
} as const satisfies EngineEndpointMap

export const NUCLEUS_INFRA_ENDPOINTS_DEFAULT = {
  natsClient: { host: 'localhost', port: 4222 },
  natsMonitor: { protocol: 'http', host: 'localhost', port: 8222 },
  postgresPgvector: { host: 'localhost', port: 5435 },
  redis: { host: 'localhost', port: 6381 }
} as const satisfies NucleusInfraEndpointMap
