import { posixCurlCommand } from '../agent-hooks/hook-post-command'
import {
  buildWindowsAgentHookPostCommand,
  getSharedManagedScriptPath
} from '../agent-hooks/installer-utils'
import {
  buildPosixHookPayloadCapture,
  buildPosixHookSpoolLines,
  buildWindowsHookEnvironmentGuardLines
} from '../agent-hooks/hook-stdin-contract'

export function getManagedScriptFileName(): string {
  return process.platform === 'win32' ? 'copilot-hook.cmd' : 'copilot-hook.sh'
}

export function getManagedScriptPath(): string {
  return getSharedManagedScriptPath(getManagedScriptFileName())
}

export function getManagedScript(target: 'local' | 'posix' = 'local'): string {
  if (target === 'local' && process.platform === 'win32') {
    return [
      '@echo off',
      'setlocal',
      // Why: Copilot consumes stdout for some hooks, so answer before any guard can exit.
      'echo {}',
      // Why: the direct registration passes the event as %1; the encoded fallback sets the env var.
      'if not "%~1"=="" set "OSHIELD_COPILOT_HOOK_EVENT=%~1"',
      // Why: refresh endpoint coordinates for PTYs surviving an Shield restart.
      'if defined OSHIELD_AGENT_HOOK_ENDPOINT if exist "%OSHIELD_AGENT_HOOK_ENDPOINT%" call "%OSHIELD_AGENT_HOOK_ENDPOINT%" 2>nul',
      ...buildWindowsHookEnvironmentGuardLines(),
      buildWindowsAgentHookPostCommand('copilot', [
        '  --data-urlencode "hookEventName=%OSHIELD_COPILOT_HOOK_EVENT%" ^'
      ]),
      'exit /b 0',
      ''
    ].join('\r\n')
  }

  return [
    '#!/bin/sh',
    "printf '{}\\n'",
    ...buildPosixHookPayloadCapture(),
    ...buildPosixHookSpoolLines('copilot'),
    // Answer Copilot before endpoint refresh, stdin parsing or posting can fail.
    'if [ -n "$OSHIELD_AGENT_HOOK_ENDPOINT" ] && [ -r "$OSHIELD_AGENT_HOOK_ENDPOINT" ]; then',
    '  . "$OSHIELD_AGENT_HOOK_ENDPOINT" 2>/dev/null || :',
    'fi',
    'if [ -z "$OSHIELD_AGENT_HOOK_PORT" ] || [ -z "$OSHIELD_AGENT_HOOK_TOKEN" ] || [ -z "$OSHIELD_PANE_KEY" ]; then',
    '  spool_hook_event',
    '  exit 0',
    'fi',
    // Keep large tool payloads off curl's command line to avoid EDR false positives.
    `printf '%s' "$payload" | ${posixCurlCommand()} -sS -X POST "http://127.0.0.1:\${OSHIELD_AGENT_HOOK_PORT}/hook/copilot" \\`,
    '  --connect-timeout 0.5 --max-time 1.5 \\',
    '  -H "Content-Type: application/x-www-form-urlencoded" \\',
    '  -H "X-Shield-Agent-Hook-Token: ${OSHIELD_AGENT_HOOK_TOKEN}" \\',
    '  --data-urlencode "paneKey=${OSHIELD_PANE_KEY}" \\',
    '  --data-urlencode "tabId=${OSHIELD_TAB_ID}" \\',
    '  --data-urlencode "launchToken=${OSHIELD_AGENT_LAUNCH_TOKEN}" \\',
    '  --data-urlencode "worktreeId=${OSHIELD_WORKTREE_ID}" \\',
    '  --data-urlencode "hookEventName=${OSHIELD_COPILOT_HOOK_EVENT}" \\',
    '  --data-urlencode "env=${OSHIELD_AGENT_HOOK_ENV}" \\',
    '  --data-urlencode "version=${OSHIELD_AGENT_HOOK_VERSION}" \\',
    '  --data-urlencode "payload@-" >/dev/null 2>&1 || spool_hook_event',
    'exit 0',
    ''
  ].join('\n')
}
