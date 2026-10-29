export type WazuhRouteRecord = {
  method: string
  path: string
  /** 'implemented' = encoded in wazuh.ts; 'verified' = spec-verified, not implemented; 'unknown' = TODO(verify). */
  status: 'implemented' | 'verified' | 'unknown'
  source: string
  notes?: string
}

// OpenAPI spec copied out of the live manager container (single-node-wazuh.manager,
// image 5.0.0-rc1) via `docker cp single-node-wazuh.manager:<SPEC_IN_CONTAINER> ...`
// — it ships inside the image, it is not checked into the repo.
export const WAZUH_SPEC_IN_CONTAINER =
  '/var/wazuh-manager/framework/python/lib/python3.12/site-packages/api/spec/spec.yaml'

const spec = (lines: string) => `wazuh spec ${WAZUH_SPEC_IN_CONTAINER}:${lines}`

// Global default `security: - jwt: []` (spec:4040-4041) applies to every path;
// the login endpoints override it with basicAuth per-operation.
// Live-verified (2026-10, in-container curl): unauthenticated GET /agents and
// GET /cluster/status → 401 {"title":"Unauthorized","detail":"No authorization
// token provided"}; POST /security/user/authenticate → 401 {"title":
// "Unauthorized","detail":"Invalid credentials"}; GET /does-not-exist → 404
// {"title":"Not Found","detail":"404: Not Found"} (distinct shape, so the 401s
// prove route presence + auth enforcement). Authenticated smoke TODO(verify):
// operator credentials unknown (pre-wipe seeded); credential reset deliberately
// not performed.
export const WAZUH_ROUTES: readonly WazuhRouteRecord[] = [
  // Auth (spec:9-33 documents the flow; securitySchemes spec:3220-3230).
  { method: 'POST', path: '/security/user/authenticate', status: 'implemented', source: spec('8202-8241'), notes: 'login; basicAuth (spec:8212-8213); 200 → ApiResponse+Token → data.token (spec:8215-8233, schema spec:1747-1752); token expires after auth_token_exp_timeout seconds, default 900 (spec:8207-8208, spec:16-18); text/plain raw variant (spec:8230-8233, param spec:3598); logout = DELETE on same path (spec:8243-8272)' },
  { method: 'DELETE', path: '/security/user/authenticate', status: 'verified', source: spec('8243-8272'), notes: 'logout — invalidates all current user tokens' },
  { method: 'POST', path: '/security/user/authenticate/run_as', status: 'verified', source: spec('8274-8301'), notes: 'login with authorization-context JSON object body; basicAuth (spec:8287-8288)' },

  // API info.
  { method: 'GET', path: '/', status: 'verified', source: spec('4044-4070'), notes: '→ BasicInfo (spec:4062, schema spec:893); JWT-required like everything else (spec:4040-4041)' },

  // Agents.
  { method: 'GET', path: '/agents', status: 'verified', source: spec('4137-4181'), notes: 'list agents → AllItemsResponseAgents (spec:4181, schema spec:639); params: agents_list, offset, limit, select, sort, search, status, query, older_than, os.*, agent_group, name, ip, registerIP, version, distinct (spec:4145-4169)' },
  { method: 'DELETE', path: '/agents', status: 'verified', source: spec('4073-4126'), notes: 'delete agents → AllItemsResponseAgentIDs (spec:4115, schema spec:709); params: agents_list_all, purge, status, older_than, query + filters (spec:4083-4102); error 1766 = deletion backlog' },
  // No GET /agents/{agent_id} in 5.0 — use GET /agents?agents_list=<id> (spec:4148).
  { method: 'PUT', path: '/agents/{agent_id}/group/{group_id}', status: 'verified', source: spec('4393-4434'), notes: 'assign agent to group; params agent_id (spec:3233-3239), group_id, force_single_group' },
  { method: 'DELETE', path: '/agents/{agent_id}/group/{group_id}', status: 'verified', source: spec('4355-4392'), notes: 'remove agent from one group' },
  { method: 'DELETE', path: '/agents/{agent_id}/group', status: 'verified', source: spec('4306-4353'), notes: 'remove agent from all/listed groups; param groups_list' },
  { method: 'PUT', path: '/agents/scan/vulnerability', status: 'verified', source: spec('5558-5569'), notes: 'on-demand vulnerability scan trigger (PUT, not POST); only vulnerability-related manager route' },

  // Groups.
  { method: 'GET', path: '/groups', status: 'verified', source: spec('5856-5877'), notes: 'list groups; params groups_list, offset, limit, sort, search, hash, query, select, distinct' },
  { method: 'DELETE', path: '/groups', status: 'verified', source: spec('5811-5855'), notes: 'delete groups; param groups_list_all' },
  { method: 'GET', path: '/groups/{group_id}/agents', status: 'verified', source: spec('5959-5992'), notes: 'agents in group → AllItemsResponseAgents (spec:5992)' },

  // Cluster / manager status.
  { method: 'GET', path: '/cluster/status', status: 'verified', source: spec('6602-6626'), notes: '→ ClusterStatus (spec:6622); manager-status equivalent — no /manager/* path exists (tag "Manager" declared spec:4021 but unused)' },
  { method: 'GET', path: '/cluster/local/info', status: 'verified', source: spec('6327-6358'), notes: 'local node info → ClusterLocalInfo (spec:6347)' },
  { method: 'GET', path: '/cluster/{node_id}/status', status: 'verified', source: spec('6796-6834'), notes: 'node readiness (daemon running/ready); inline response schema, no named model' },

  // TODO(verify) — absent from the manager 5.0 spec (76-path inventory read in
  // full); likely served by the Wazuh indexer (9200, compose-verified — see
  // WAZUH_COMPOSE_CITATIONS.indexerHttpsHealthcheck), which has its own API.
  { method: 'GET', path: '#alerts-search', status: 'unknown', source: 'not found', notes: 'TODO(verify): no /alerts path in manager spec — alert/event search is indexer-side; needs the indexer API spec' },
  { method: 'GET', path: '#vulnerability-findings', status: 'unknown', source: 'not found', notes: 'TODO(verify): manager spec only exposes the scan trigger (PUT /agents/scan/vulnerability, spec:5558); findings retrieval is indexer-side' },
  { method: 'GET', path: '#rules-detection', status: 'unknown', source: 'not found', notes: 'TODO(verify): no detection /rules path — only /security/rules (spec:9158) which is RBAC, not detection rules' },
  { method: 'GET', path: '#decoders', status: 'unknown', source: 'not found', notes: 'TODO(verify): no /decoders path in manager spec (5.0 engine moved parsing out of ossec analysisd paths)' },
  { method: 'GET', path: '#manager-status', status: 'unknown', source: 'not found', notes: 'TODO(verify): no /manager/status path — use GET /cluster/status (spec:6602) and GET /cluster/{node_id}/status (spec:6796)' }
]

// Compose-verified non-Routes facts — re-cited from
// engines/wazuh-docker/single-node/docker-compose.yml.
export const WAZUH_COMPOSE_CITATIONS = {
  managerApiPort55000Mapped: 'engines/wazuh-docker/single-node/docker-compose.yml:29',
  agentInboundPorts: 'engines/wazuh-docker/single-node/docker-compose.yml:25-28',
  apidTlsCertMounts: 'engines/wazuh-docker/single-node/docker-compose.yml:50-51',
  remotedTlsCertMounts: 'engines/wazuh-docker/single-node/docker-compose.yml:48-49',
  rootCaMount: 'engines/wazuh-docker/single-node/docker-compose.yml:45',
  indexerHttpsHealthcheck: 'engines/wazuh-docker/single-node/docker-compose.yml:79',
  dashboardPortMapping: 'engines/wazuh-docker/single-node/docker-compose.yml:103-104'
} as const

export type WazuhRouteTable = typeof WAZUH_ROUTES
