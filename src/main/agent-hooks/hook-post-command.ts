import type { AgentHookSource } from '../../shared/agent-hook-relay'
import { OSHIELD_HOOK_RAW_JSON_TRANSPORT } from '../../shared/agent-hook-types'

// Older curl needs C numeric parsing; keep the parent script's UTF-8 locale unchanged.
export function posixCurlCommand(curlCommand = 'curl'): string {
  return `LC_ALL= LC_NUMERIC=C ${curlCommand}`
}

export function buildPosixAgentHookPostCommand(
  source: AgentHookSource,
  options: { curlCommand?: string; indent?: string } = {}
): string[] {
  const curlCommand = posixCurlCommand(options.curlCommand ?? 'curl')
  const indent = options.indent ?? '  '
  return [
    `if [ "\${OSHIELD_AGENT_HOOK_TRANSPORT:-}" = "${OSHIELD_HOOK_RAW_JSON_TRANSPORT}" ] && command -v base64 >/dev/null 2>&1 && command -v tr >/dev/null 2>&1; then`,
    `  shield_hook_metadata=$(printf '%s\\037%s\\037%s\\037%s\\037%s\\037%s' "$OSHIELD_PANE_KEY" "$OSHIELD_TAB_ID" "$OSHIELD_AGENT_LAUNCH_TOKEN" "$OSHIELD_WORKTREE_ID" "$OSHIELD_AGENT_HOOK_ENV" "$OSHIELD_AGENT_HOOK_VERSION" | base64 | tr -d '\\n') && \\`,
    `  [ -n "$shield_hook_metadata" ] && \\`,
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST "http://127.0.0.1:\${OSHIELD_AGENT_HOOK_PORT}/hook/${source}" \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/json" \\`,
    `  ${indent}-H "X-Shield-Agent-Hook-Token: \${OSHIELD_AGENT_HOOK_TOKEN}" \\`,
    `  ${indent}-H "X-Shield-Agent-Hook-Meta-Encoding: base64" \\`,
    `  ${indent}-H "X-Shield-Agent-Hook-Meta: \${shield_hook_metadata}" \\`,
    `  ${indent}-H "X-Shield-Agent-Process: \${shield_agent_process:-}" \\`,
    `  ${indent}--data-binary @-`,
    'else',
    `  printf '%s' "$payload" | ${curlCommand} -sS -X POST "http://127.0.0.1:\${OSHIELD_AGENT_HOOK_PORT}/hook/${source}" \\`,
    `  ${indent}--connect-timeout "\${connect_timeout:-0.5}" --max-time "\${max_time:-1.5}" \\`,
    `  ${indent}--noproxy "127.0.0.1" \\`,
    `  ${indent}-H "Content-Type: application/x-www-form-urlencoded" \\`,
    `  ${indent}-H "X-Shield-Agent-Hook-Token: \${OSHIELD_AGENT_HOOK_TOKEN}" \\`,
    `  ${indent}--data-urlencode "paneKey=\${OSHIELD_PANE_KEY}" \\`,
    `  ${indent}--data-urlencode "tabId=\${OSHIELD_TAB_ID}" \\`,
    `  ${indent}--data-urlencode "launchToken=\${OSHIELD_AGENT_LAUNCH_TOKEN}" \\`,
    `  ${indent}--data-urlencode "worktreeId=\${OSHIELD_WORKTREE_ID}" \\`,
    `  ${indent}--data-urlencode "env=\${OSHIELD_AGENT_HOOK_ENV}" \\`,
    `  ${indent}--data-urlencode "version=\${OSHIELD_AGENT_HOOK_VERSION}" \\`,
    `  ${indent}--data-urlencode "agentProcess=\${shield_agent_process:-}" \\`,
    `  ${indent}--data-urlencode "payload@-"`,
    'fi'
  ]
}
