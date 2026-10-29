// Mythic GraphQL documents whose signatures AND output shapes are in-repo.
// Schema source: engines/mythic/hasura-docker/metadata/actions.graphql
// (Hasura custom actions served on /v1/graphql, fronted at /graphql/ —
// engines/mythic/nginx-docker/config/conf.d/services.conf:119-120).
// Live introspection (2026-10-28): POST https://localhost:7443/graphql/ __schema
// → "Authentication hook unauthorized this request" (extensions.code:
// access-denied). The auth hook is mythic server POST /graphql/webhook →
// GetHasuraClaims (mythic-docker/src/webserver/initialize.go:197); JWT parsed
// from Authorization: Bearer (mythic-docker/src/authentication/jwt.go:164-208).
// Table-backed generated fields (callback/task/operation) are tracked tables
// (tables.yaml cited per entry below); generated root-field NAMES are exercised
// by vendored MythicReactUI documents (see the resolved-records block below)
// and column-level field lists were introspected live on 2026-10-29 (see
// MYTHIC_TABLE_COLUMNS below).

export const MYTHIC_CREATE_TASK_DOCUMENT = `
mutation ShieldMythicCreateTask($command: String!, $params: String!, $callback_id: Int) {
  createTask(command: $command, params: $params, callback_id: $callback_id) {
    status
    error
    id
    display_id
  }
}`

// createTask signature: engines/mythic/hasura-docker/metadata/actions.graphql:187-203.
// createTaskOutput fields {status: String!, error: String, id: Int, display_id: Int}:
// actions.graphql:762-767. Optional args verified in the signature: payload_type,
// files, callback_ids, token_id, tasking_location, original_params,
// parameter_group_name, parent_task_id, is_interactive_task,
// interactive_task_type (actions.graphql:188-202).
export type ShieldMythicCreateTaskOutput = {
  status: string
  error: string | null
  id: number | null
  display_id: number | null
}

export const MYTHIC_ME_HOOK_DOCUMENT = `
query ShieldMythicMeHook {
  meHook {
    status
    error
    current_operation_id
    current_operation
  }
}`

// meHook: engines/mythic/hasura-docker/metadata/actions.graphql:434-436;
// meHookOutput {status, error, current_operation_id, current_operation}:
// actions.graphql:896-901.
export type ShieldMythicMeHookOutput = {
  status: string
  error: string | null
  current_operation_id: number | null
  current_operation: string | null
}

export const MYTHIC_CREATE_API_TOKEN_DOCUMENT = `
mutation ShieldMythicCreateApiToken($token_type: String!, $operator_id: Int, $name: String) {
  createAPIToken(token_type: $token_type, operator_id: $operator_id, name: $name) {
    status
    error
    token_value
    id
    name
    operator_id
    token_type
    creation_time
  }
}`

// createAPIToken: engines/mythic/hasura-docker/metadata/actions.graphql:90-96;
// createAPITokenResponse: actions.graphql:683-693 (also carries created_by:
// Int). token_type is free-form text, not an enum (mythic-docker/src/database/
// schema.go:703 `token_type text NOT NULL`). Values in-repo: "User"
// (MythicReactUI/src/components/pages/Settings/SettingsOperatorTableRow.js:40);
// "task"/"graphql_spectator"/"event" for server-generated tokens
// (mythic-docker/src/rabbitmq/recv_mythic_rpc_apitoken_create.go:53,111,
// check_container_status.go:181, eventing.go:1029; invalidated wholesale at
// initialize.go:175-178). The minted JWT's auth claim is "api"
// (user_generate_apitoken_webhook.go:105).
export type ShieldMythicCreateApiTokenOutput = {
  status: string
  error: string | null
  token_value: string | null
  id: number | null
  name: string | null
  operator_id: number | null
  token_type: string | null
  creation_time: string | null
}

// RESOLVED in-repo (2026-10-28):
// - Generated root-field names hold to Hasura convention and are exercised by
//   vendored MythicReactUI documents: callback / callback_by_pk
//   (MythicReactUI/src/components/pages/Callbacks/DetailedCallbackTable.js:39,
//   AddRemoveCallbackCommandsDialog.js:19), update_apitokens_by_pk
//   (Settings/SettingsOperatorTableRow.js:65). Tracked tables: callback
//   tables.yaml:1583-1585, apitokens tables.yaml:4-6, c2profile
//   tables.yaml:1146-1148; task/operation via apitokens array relationships
//   tables.yaml:132-138 / :76-82.
// - Hasura REST (/v2/, /v1alpha1/ proxied at services.conf:91-118): both
//   metadata/rest_endpoints.yaml:1 and query_collections.yaml:1 are `[]` — no
//   REST endpoints are defined by the checked-in metadata; nothing to encode.
// - Token bootstrap: POST /auth {username, password, scripting_version?} →
//   {access_token, refresh_token, user} (mythic-docker/src/webserver/
//   initialize.go:155 → controllers/login.go:15-58); the access_token then
//   serves as Authorization: Bearer for /graphql/ (authentication/jwt.go:164-208).
// RESOLVED (introspection 2026-10-29): the column-level field lists below come
// from a live authenticated introspection — POST https://localhost:7443/graphql/
// __schema with a POST /auth JWT (mythic_admin). Each root field is a Hasura
// select-field generator with args (distinct_on, limit, offset, order_by,
// where) returning [table!]! over the tracked table cited above. `columns` is
// the complete field set Hasura generates on the table object type: table
// columns plus relationship/array and <rel>_aggregate fields, in the
// alphabetical order introspection returned.
export type MythicTableColumns = {
  table: string
  columns: readonly string[]
}

export const MYTHIC_TABLE_COLUMNS: readonly MythicTableColumns[] = [
  {
    // callback tables.yaml:1583-1585; root field → [callback!]!
    table: 'callback',
    columns: [
      'active', 'agent_callback_id', 'apitokens', 'architecture',
      'c2profileparametersinstances', 'callbackc2profiles', 'callbackgraphedges',
      'callbackgraphedgesByDestinationId', 'callbackgraphedgesByDestinationId_aggregate',
      'callbackgraphedges_aggregate', 'callbackports', 'callbackports_aggregate',
      'callbacktokens', 'color', 'crypto_type', 'current_time', 'cwd', 'dead',
      'dec_key', 'dec_key_base64', 'description', 'display_id', 'domain',
      'enc_key', 'enc_key_base64', 'eventstepinstance', 'eventstepinstance_id',
      'external_ip', 'extra_info', 'host', 'id', 'impersonation_context',
      'init_callback', 'integrity_level', 'ip', 'last_checkin', 'loadedcommands',
      'locked', 'locked_operator', 'locked_operator_id', 'mythictree_groups',
      'mythictree_groups_string', 'mythictrees', 'mythictrees_aggregate',
      'operation', 'operation_id', 'operator', 'operator_id', 'os', 'payload',
      'pid', 'process_name', 'process_short_name', 'registered_payload_id',
      'sleep_info', 'tags', 'tags_aggregate', 'tasks', 'tasks_aggregate',
      'timestamp', 'trigger_on_checkin_after_time', 'user',
    ],
  },
  {
    // task via apitokens array relationship tables.yaml:132-138; root field → [task!]!
    table: 'task',
    columns: [
      'agent_task_id', 'apitoken', 'apitokens', 'apitokens_id', 'attacktasks',
      'callback', 'callback_id', 'callbackports', 'callbackports_aggregate',
      'callbacktokens', 'command', 'command_id', 'command_name',
      'command_payload_type', 'comment', 'commentOperator',
      'comment_operator_id', 'completed', 'completed_callback_function',
      'completed_callback_function_completed', 'credentials',
      'credentials_aggregate', 'display_id', 'display_params',
      'eventstepinstance', 'eventstepinstance_id', 'filemeta',
      'filemeta_aggregate', 'group_callback_function',
      'group_callback_function_completed', 'has_intercepted_response', 'id',
      'interactive_task_type', 'is_interactive_task', 'keylogs',
      'keylogs_aggregate', 'mythic_parsed_params', 'mythictrees',
      'mythictrees_aggregate', 'operation_id', 'operator', 'operator_id',
      'opsec_post_blocked', 'opsec_post_bypass_role', 'opsec_post_bypass_user',
      'opsec_post_bypass_user_id', 'opsec_post_bypassed', 'opsec_post_message',
      'opsec_pre_blocked', 'opsec_pre_bypass_role', 'opsec_pre_bypass_user',
      'opsec_pre_bypass_user_id', 'opsec_pre_bypassed', 'opsec_pre_message',
      'original_params', 'parameter_group_name', 'params', 'parent_task_id',
      'payloadonhosts', 'payloads', 'payloads_aggregate',
      'process_at_original_command', 'response_count', 'responses',
      'responses_aggregate', 'status', 'status_timestamp_preprocessing',
      'status_timestamp_processed', 'status_timestamp_processing',
      'status_timestamp_submitted', 'stderr', 'stdout',
      'subtask_callback_function', 'subtask_callback_function_completed',
      'subtask_group_name', 'tags', 'tags_aggregate', 'task',
      'taskartifacts', 'taskartifacts_aggregate', 'tasking_location', 'tasks',
      'tasks_aggregate', 'timestamp', 'token', 'token_id', 'tokens',
      'tokens_aggregate',
    ],
  },
  {
    // operation via apitokens array relationship tables.yaml:76-82; root field → [operation!]!
    table: 'operation',
    columns: [
      'admin', 'admin_id', 'alert_count', 'apitoken', 'apitokens_id',
      'banner_color', 'banner_text', 'browserscriptoperations',
      'c2profileparametersinstances', 'callbackgraphedges',
      'callbackgraphedges_aggregate', 'callbackports', 'callbackports_aggregate',
      'callbacks', 'callbacks_aggregate', 'channel', 'complete', 'credentials',
      'credentials_aggregate', 'deleted', 'disabledcommandsprofiles',
      'eventgroupapprovals', 'eventgroupinstances', 'eventgroups',
      'eventgroups_aggregate', 'eventstepinstances', 'eventsteps', 'filemeta',
      'filemeta_aggregate', 'id', 'keylogs', 'keylogs_aggregate',
      'mythictrees', 'mythictrees_aggregate', 'name', 'operationeventlogs',
      'operationeventlogs_aggregate', 'operatoroperations', 'operators',
      'payloadonhosts', 'payloads', 'payloads_aggregate', 'responses',
      'responses_aggregate', 'tags', 'tags_aggregate', 'tagtypes',
      'tagtypes_aggregate', 'taskartifacts', 'taskartifacts_aggregate',
      'updated_at', 'webhook',
    ],
  },
  {
    // apitokens tables.yaml:4-6; root field → [apitokens!]!
    table: 'apitokens',
    columns: [
      'active', 'callback', 'callback_id', 'callbackgraphedges',
      'callbackgraphedges_aggregate', 'created_by', 'created_by_operator',
      'creation_time', 'credentials', 'credentials_aggregate', 'deleted',
      'eventstepinstance', 'eventstepinstance_id', 'filemeta',
      'filemeta_aggregate', 'id', 'keylogs', 'keylogs_aggregate',
      'loadedcommands', 'mythictrees', 'mythictrees_aggregate', 'name',
      'operationeventlogs', 'operationeventlogs_aggregate', 'operations',
      'operator', 'operator_id', 'operatoroperations', 'operators', 'payload',
      'payload_id', 'payloads', 'payloads_aggregate', 'responses',
      'responses_aggregate', 'tags', 'tags_aggregate', 'tagtypes',
      'tagtypes_aggregate', 'task', 'task_id', 'taskartifacts',
      'taskartifacts_aggregate', 'tasks', 'tasks_aggregate', 'token_type',
      'token_value',
    ],
  },
  {
    // c2profile tables.yaml:1146-1148; root field → [c2profile!]!
    table: 'c2profile',
    columns: [
      'author', 'c2profileparameters', 'c2profileparametersinstances',
      'callbackc2profiles', 'callbackgraphedges', 'callbackgraphedges_aggregate',
      'container_running', 'creation_time', 'deleted', 'description',
      'has_logo', 'id', 'is_p2p', 'is_server_routed', 'name',
      'payloadc2profiles', 'payloadtypec2profiles', 'running', 'semver',
    ],
  },
]
