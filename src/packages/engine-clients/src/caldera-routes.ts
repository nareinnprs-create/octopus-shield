export type CalderaRouteRecord = {
  api: 'v2' | 'core-rest'
  method: string
  path: string
  /** 'implemented' = encoded in caldera.ts; 'verified' = source-verified, not implemented. */
  status: 'implemented' | 'verified' | 'unknown'
  source: string
  notes?: string
}

// v2 paths are registered under the /api/v2 subapp mount — engines/caldera/server.py:309.
export const CALDERA_ROUTES: readonly CalderaRouteRecord[] = [
  // /api/v2/health live-verified (2026-10): 401 without a KEY header; any HTTP response proves the engine process is reachable.
  { api: 'v2', method: 'GET', path: '/api/v2/health', status: 'implemented', source: 'engines/caldera/app/api/v2/handlers/health_api.py:18', notes: 'health probe semantics: 401-expected-without-key; any HTTP response = reachable (see @shield/octopod engine-probes)' },
  { api: 'v2', method: 'GET', path: '/api/v2/abilities', status: 'implemented', source: 'engines/caldera/app/api/v2/handlers/ability_api.py:18' },
  { api: 'v2', method: 'GET', path: '/api/v2/adversaries', status: 'implemented', source: 'engines/caldera/app/api/v2/handlers/adversary_api.py:21' },
  { api: 'v2', method: 'GET', path: '/api/v2/abilities/{ability_id}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/ability_api.py:19' },
  { api: 'v2', method: 'POST', path: '/api/v2/abilities', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/ability_api.py:20', notes: 'body AbilitySchema (ability_api.py:53); fields c_ability.py:19-34 (unknown=EXCLUDE :16-17, id→ability_id pre_load :36-40); executors = List[Nested(ExecutorSchema)] :25; handler docs mark name/tactic/technique_name/technique_id/executors required (ability_api.py:50-52)' },
  { api: 'v2', method: 'PUT', path: '/api/v2/abilities/{ability_id}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/ability_api.py:21' },
  { api: 'v2', method: 'DELETE', path: '/api/v2/abilities/{ability_id}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/ability_api.py:23' },
  { api: 'v2', method: 'POST', path: '/api/v2/adversaries', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/adversary_api.py:23', notes: 'body AdversarySchema (adversary_api.py:60); fields c_adversary.py:17-24 (has_repeatable_abilities dump-only :23, unknown=EXCLUDE :14-15); id→adversary_id pre_load :26-30; legacy phases→atomic_ordering :32-42' },
  { api: 'v2', method: 'GET', path: '/api/v2/agents', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/agent_api.py:19' },
  { api: 'v2', method: 'GET', path: '/api/v2/agents/{paw}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/agent_api.py:20' },
  { api: 'v2', method: 'POST', path: '/api/v2/agents/kill/{paw}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/agent_api.py:22' },
  { api: 'v2', method: 'PUT', path: '/api/v2/agents/{paw}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/agent_api.py:24' },
  { api: 'v2', method: 'DELETE', path: '/api/v2/agents/{paw}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/agent_api.py:25' },
  { api: 'v2', method: 'GET', path: '/api/v2/deploy_commands', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/agent_api.py:27' },
  { api: 'v2', method: 'GET', path: '/api/v2/deploy_commands/{ability_id}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/agent_api.py:28' },
  { api: 'v2', method: 'GET', path: '/api/v2/operations', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:23' },
  { api: 'v2', method: 'GET', path: '/api/v2/operations/summary', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:24' },
  { api: 'v2', method: 'GET', path: '/api/v2/operations/{id}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:25' },
  { api: 'v2', method: 'POST', path: '/api/v2/operations', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:26', notes: 'body OperationSchema (operation_api.py:94); fields c_operation.py:42-58 — schema-required: name (:43); handler docs require name, adversary.adversary_id, planner.id, source.id (operation_api.py:89-93); host_group/start/chain/objective stripped pre-load (:60-66, dump-only :44,:48,:52)' },
  { api: 'v2', method: 'DELETE', path: '/api/v2/operations/{id}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:28' },
  { api: 'v2', method: 'POST', path: '/api/v2/operations/{id}/report', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:29' },
  { api: 'v2', method: 'POST', path: '/api/v2/operations/{id}/event-logs', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:30' },
  { api: 'v2', method: 'GET', path: '/api/v2/operations/{id}/links', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:31' },
  { api: 'v2', method: 'GET', path: '/api/v2/operations/{id}/links/{link_id}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:32' },
  { api: 'v2', method: 'GET', path: '/api/v2/operations/{id}/links/{link_id}/result', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:33' },
  { api: 'v2', method: 'POST', path: '/api/v2/operations/{id}/potential-links', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:35' },
  { api: 'v2', method: 'GET', path: '/api/v2/operations/{id}/potential-links', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:36' },
  { api: 'v2', method: 'GET', path: '/api/v2/operations/{id}/potential-links/{paw}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/operation_api.py:37' },
  { api: 'v2', method: 'GET', path: '/api/v2/sources', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/fact_source_api.py:18' },
  { api: 'v2', method: 'GET', path: '/api/v2/sources/{id}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/fact_source_api.py:19' },
  { api: 'v2', method: 'GET', path: '/api/v2/objectives', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/objective_api.py:18' },
  { api: 'v2', method: 'GET', path: '/api/v2/objectives/{id}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/objective_api.py:19' },
  { api: 'v2', method: 'GET', path: '/api/v2/planners', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/planner_api.py:18' },
  { api: 'v2', method: 'GET', path: '/api/v2/schedules', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/schedule_api.py:21' },
  { api: 'v2', method: 'POST', path: '/api/v2/schedules', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/schedule_api.py:23', notes: 'body ScheduleSchema (schedule_api.py:55); fields c_schedule.py:16-18 — schedule required + cron-validated (:17,:20-23); task = nested OperationSchema (:18), read from data["task"] (schedule_api.py:130-132)' },
  { api: 'v2', method: 'GET', path: '/api/v2/obfuscators', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/obfuscator_api.py:18' },
  { api: 'v2', method: 'GET', path: '/api/v2/payloads', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/payload_api.py:30' },
  { api: 'v2', method: 'GET', path: '/api/v2/plugins', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/plugins_api.py:18' },
  { api: 'v2', method: 'GET', path: '/api/v2/plugins/{name}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/plugins_api.py:19' },
  { api: 'v2', method: 'GET', path: '/api/v2/facts', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/fact_api.py:21' },
  { api: 'v2', method: 'GET', path: '/api/v2/relationships', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/fact_api.py:22' },
  { api: 'v2', method: 'GET', path: '/api/v2/contacts', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/contact_api.py:17' },
  { api: 'v2', method: 'GET', path: '/api/v2/contactlist', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/contact_api.py:18' },
  { api: 'v2', method: 'GET', path: '/api/v2/config/{name}', status: 'verified', source: 'engines/caldera/app/api/v2/handlers/config_api.py:17' },
  // core REST (engines/caldera/app/api/rest_api.py route registrations :38-48). Auth via KEY header or session cookie.
  { api: 'core-rest', method: 'POST', path: '/enter', status: 'verified', source: 'engines/caldera/app/api/rest_api.py:39', notes: 'auth_svc.login_user (rest_api.py:50-51 → auth_svc.py:116-139); body = form-encoded username/password (login_handlers/default.py:20-23); outcome is always 302 → / (success: default.py:30-36 via handle_successful_login auth_svc.py:179-183; failure falls through :35-36) — UI session bootstrap, not an API auth flow' },
  { api: 'core-rest', method: 'POST', path: '/logout', status: 'verified', source: 'engines/caldera/app/api/rest_api.py:40' },
  { api: 'core-rest', method: '*', path: '/file/download', status: 'verified', source: 'engines/caldera/app/api/rest_api.py:42' },
  { api: 'core-rest', method: 'POST', path: '/file/upload', status: 'verified', source: 'engines/caldera/app/api/rest_api.py:43' },
  { api: 'core-rest', method: 'POST', path: '/api/rest', status: 'verified', source: 'engines/caldera/app/api/rest_api.py:45', notes: 'body {"index": ...}; DELETE/PUT/POST dispatch rest_api.py:69-97 — DELETE: agents/operations/abilities/adversaries; PUT: adversaries/abilities/sources/objectives/planners/agents/chain/operations/schedule/link/manual_command; POST: operation_report/result/contact/link/operation/task/agent_configuration/exfil_files' },
  { api: 'core-rest', method: 'GET', path: '/api/{index}', status: 'verified', source: 'engines/caldera/app/api/rest_api.py:46', notes: 'display_objects(query search) (rest_api.py:114-117 → rest_svc.py:123-125 → data_svc.locate); valid index set = data_svc schema keys (data_svc.py:52-53): agents, planners, adversaries, abilities, sources, operations, schedules, plugins, obfuscators, objectives, data_encoders; unknown index → KeyError/500 (data_svc.py:139)' },
  { api: 'core-rest', method: 'GET', path: '/file/download_exfil', status: 'verified', source: 'engines/caldera/app/api/rest_api.py:47' },
  { api: 'core-rest', method: 'GET', path: '#unverified', status: 'unknown', source: 'not found', notes: 'core REST registers no dedicated health route (rest_api.py:38-48); /api/v2/health is the verified health endpoint. TODO(verify) plugin-registered health paths (depends on the enabled-plugin set at runtime)' }
]
