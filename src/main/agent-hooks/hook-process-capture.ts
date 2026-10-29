/** Capture before Shield inserts its managed-script shell. */
export const CLAUDE_HOOK_PARENT_CAPTURE =
  'OSHIELD_HOOK_AGENT_PID="${PPID:-}"; export OSHIELD_HOOK_AGENT_PID; '

export function buildHookProcessCapture(): string[] {
  return [
    'shield_agent_process=',
    '[ -z "${OSHIELD_PANE_KEY:-}" ] || case "${OSHIELD_HOOK_AGENT_PID:-}" in ""|*[!0-9]*) ;; *)',
    '  if [ -r "/proc/$OSHIELD_HOOK_AGENT_PID/stat" ]; then',
    '    shield_agent_stat=$(cat "/proc/$OSHIELD_HOOK_AGENT_PID/stat" 2>/dev/null) || shield_agent_stat=',
    '    shield_agent_boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null) || shield_agent_boot=',
    '    shield_agent_fields=${shield_agent_stat##*) }',
    '    shield_agent_start=$(printf "%s" "$shield_agent_fields" | awk \'{print $20}\')',
    '    case "$shield_agent_start" in ""|*[!0-9]*) ;; *)',
    '      [ -z "$shield_agent_boot" ] || shield_agent_process=$(printf \'{"pid":%s,"platform":"linux","startTime":"%s:%s"}\' "$OSHIELD_HOOK_AGENT_PID" "$shield_agent_boot" "$shield_agent_start") ;; esac',
    '  elif [ "$(uname -s 2>/dev/null)" = Darwin ]; then',
    // Match the host probe's timezone when comparing local-time lstart strings.
    '    shield_agent_start=$(TZ=UTC0 LC_ALL=C /bin/ps -p "$OSHIELD_HOOK_AGENT_PID" -o lstart= 2>/dev/null | sed \'s/^ *//;s/ *$//\')',
    '    [ -z "$shield_agent_start" ] || shield_agent_process=$(printf \'{"pid":%s,"platform":"darwin","startTime":"%s"}\' "$OSHIELD_HOOK_AGENT_PID" "$shield_agent_start")',
    '  fi ;;',
    'esac'
  ]
}
