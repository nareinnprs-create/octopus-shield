import type { EngineHttpEndpoint } from './engine-endpoints'

export type WazuhAgentStatus = 'active' | 'disconnected' | 'never_connected' | 'pending'

export type WazuhAgentSummary = {
  id: string
  name: string
  status: WazuhAgentStatus
  ip?: string
  version?: string
  group?: readonly string[]
}

export type WazuhAlert = {
  id: string
  timestamp: string
  rule: { id: string; level: number; description: string }
  agent?: { id: string; name?: string }
  decoder?: string
}

export type WazuhManagerAuth = {
  /** Manager API token; acquisition/refresh stays in the client implementation. */
  token: string
}

/** Wazuh manager API (55000) adapter contract; client implementation lives outside this package. */
export interface WazuhManagerAdapter {
  readonly managerApi: EngineHttpEndpoint
  listAgents(context: WazuhManagerAuth): Promise<readonly WazuhAgentSummary[]>
  listRecentAlerts(context: WazuhManagerAuth, limit: number): Promise<readonly WazuhAlert[]>
}
