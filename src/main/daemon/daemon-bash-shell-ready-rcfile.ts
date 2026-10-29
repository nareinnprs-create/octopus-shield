import { getPosixOmpShellWrapper } from '../pty/omp-shell-wrapper'
import { OSHIELD_CLI_POSIX_PATH_RESTORE } from '../../shared/shield-cli-shell-path'
import { MANAGED_DATA_ACCOUNT_POSIX_RESTORE } from '../../shared/managed-data-account-shell'
import { getPosixCodexShellLaunchPreflight } from '../../shared/codex-shell-function'
import { getPosixClaudeShellFunction } from '../../shared/claude-shell-function'
import { BASH_PROMPT_COMMAND_COMPOSITION_BLOCK } from '../bash-prompt-command-composition'
import { BASH_FEATURE_CHANNEL_BLOCK, SHELL_STARTUP_IDENTITY_MARKER_BLOCK } from '../shell-templates'

export function getDaemonBashShellReadyRcfileContent(): string {
  return `# Shield daemon bash shell-ready wrapper
${BASH_FEATURE_CHANNEL_BLOCK}
${SHELL_STARTUP_IDENTITY_MARKER_BLOCK}
# Consume the feature channel before profiles so child processes cannot inherit the selection.
__shield_ready_marker=""
__shield_has_feature ready && __shield_ready_marker=1
unset _shield_shell_features
unset -f __shield_has_feature
[[ -f /etc/profile ]] && source /etc/profile
if [[ -f "$HOME/.bash_profile" ]]; then
  source "$HOME/.bash_profile"
elif [[ -f "$HOME/.bash_login" ]]; then
  source "$HOME/.bash_login"
elif [[ -f "$HOME/.profile" ]]; then
  source "$HOME/.profile"
fi
# Force bracketed paste on older readline so multiline startup prompts remain one literal paste.
[[ $- == *i* ]] && bind 'set enable-bracketed-paste on' 2>/dev/null
__shield_restore_agent_teams_path() {
  [[ -n "\${OSHIELD_AGENT_TEAMS_SHIM_DIR:-}" ]] || return 0
  case "$PATH" in
    "\${OSHIELD_AGENT_TEAMS_SHIM_DIR}"|"\${OSHIELD_AGENT_TEAMS_SHIM_DIR}:"*) return 0 ;;
  esac
  export PATH="\${OSHIELD_AGENT_TEAMS_SHIM_DIR}:$PATH"
}
__shield_restore_agent_teams_path
${OSHIELD_CLI_POSIX_PATH_RESTORE}
# Restore the managed OpenCode config after user profiles may have replaced it.
[[ -n "\${OSHIELD_OPENCODE_CONFIG_DIR:-}" ]] && export OPENCODE_CONFIG_DIR="\${OSHIELD_OPENCODE_CONFIG_DIR}"
${MANAGED_DATA_ACCOUNT_POSIX_RESTORE}
[[ -n "\${OSHIELD_MIMOCODE_CONFIG_DIR:-}" ]] && export MIMOCODE_CONFIG_DIR="\${OSHIELD_MIMOCODE_CONFIG_DIR}"
${getPosixOmpShellWrapper()}
# Preserve the managed CODEX_HOME after user profiles.
[[ -n "\${OSHIELD_CODEX_HOME:-}" ]] && export CODEX_HOME="\${OSHIELD_CODEX_HOME}"
${getPosixCodexShellLaunchPreflight() + getPosixClaudeShellFunction()}
# OSC 133 C/D clears stale agent status when a CLI exits without a stop hook.
__shield_initializing_wrapper=1
__shield_osc133_precmd() {
  local exit_code=$?
  __shield_in_prompt_command=1
  if [[ -n "\${__shield_in_command:-}" ]]; then
    printf "\\033]133;D;%s\\007" "$exit_code"
    unset __shield_in_command
  fi
  printf "\\033]133;A\\007"
  return "$exit_code"
}
__shield_osc133_preexec() {
  if [[ -n "\${__shield_prompt_status_capture_command:-}" && "$BASH_COMMAND" == "$__shield_prompt_status_capture_command" ]]; then
    unset __shield_initial_prompt
    __shield_in_legacy_prompt_wrapper=1
    return 0
  fi
  if [[ -n "\${__shield_initializing_wrapper:-}\${__shield_in_debug_capture:-}\${__shield_initial_prompt:-}\${__shield_in_prompt_dispatch:-}\${__shield_in_legacy_prompt_wrapper:-}\${__shield_in_prompt_command:-}" ]]; then
    [[ -z "\${__shield_initializing_wrapper:-}\${__shield_in_debug_capture:-}" ]] || return 0
    if [[ -n "\${__shield_initial_prompt:-}" && "$BASH_COMMAND" == "__shield_osc133_precmd" ]]; then
      unset __shield_initial_prompt; return 0
    fi
    if [[ -n "\${__shield_in_prompt_dispatch:-}" ]]; then
      [[ -n "\${__shield_dispatching_user_prompt_command:-}" ]] || return 0
      if [[ "\${FUNCNAME[1]:-}" == "__shield_run_prompt_command_array" ]]; then
        case "$BASH_COMMAND" in
          '(( __shield_exit_code == 0 ))'|'__shield_restore_prompt_status "$__shield_exit_code"'|'eval "$__shield_prompt_part"'|'eval "$__shield_final_prompt_command"'|__shield_dispatching_user_prompt_command=*|__shield_osc133_precmd|__shield_osc133_epilogue) return 0 ;;
        esac
      fi
    elif [[ "\${FUNCNAME[1]:-}" == "__shield_run_prompt_command_array" || "$BASH_COMMAND" == "__shield_run_prompt_command_array" ]]; then
      return 0
    fi
    [[ -z "\${__shield_in_legacy_prompt_wrapper:-}" || -n "\${__shield_dispatching_user_prompt_command:-}" ]] || return 0
    if [[ -n "\${__shield_in_prompt_command:-}" && "$BASH_COMMAND" == "__shield_in_debug_capture=1" ]]; then
      return 0
    fi
  fi
  case "\${FUNCNAME[1]:-}" in
    __shield_osc133_*|__shield_restore_prompt_status|__bp_*) return 0 ;;
  esac
  case "$BASH_COMMAND" in
    __shield_osc133_precmd|__shield_osc133_epilogue) return 0 ;;
    # The prefix is only special while bash-preexec prompt hooks run.
    __bp_*) [[ -n "\${__shield_in_prompt_command:-}" ]] && return 0 ;;
  esac
  __shield_run_user_debug_trap
  # Chain the framework trap captured before each prompt's lifecycle re-arm.
  if [[ -n "\${__shield_chained_debug_trap:-}" ]]; then
    eval "$__shield_chained_debug_trap" || true
  fi
  [[ -z "\${__shield_in_prompt_command:-}" ]] || return 0
  # Emit C once per foreground command, excluding prompt hooks and repeated chained-trap calls.
  [[ -z "\${__shield_in_command:-}" ]] || return 0
  printf "\\033]133;C\\007"
  __shield_in_command=1
}
# Adopt the latest user trap before reclaiming lifecycle ownership.
__shield_osc133_epilogue() {
  unset __shield_in_prompt_command
  __shield_adopt_outer_debug_trap
  trap '__shield_osc133_preexec' DEBUG
  # Readline renders PS1 after entering raw mode; prompt hooks still run in cooked mode.
  if [[ -n "$__shield_ready_marker" ]]; then
    PS1="\${PS1-}"'\\[\\e]777;shield-shell-ready\\a\\]'
    __shield_ready_marker=""
  fi
}
${BASH_PROMPT_COMMAND_COMPOSITION_BLOCK}
__shield_prepend_prompt_command "__shield_osc133_precmd"
__shield_append_prompt_command '__shield_in_debug_capture=1; __shield_prompt_had_functrace=""; if [[ -o functrace ]]; then __shield_prompt_had_functrace=1; set +T; fi; __shield_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__shield_prompt_had_functrace" ]] || set -T; unset __shield_prompt_had_functrace __shield_in_debug_capture'
__shield_append_prompt_command "__shield_osc133_epilogue"
__shield_had_functrace=""
[[ -o functrace ]] && __shield_had_functrace=1
set +T
__shield_debug_trap_spec="$(trap -p DEBUG)"
[[ -z "$__shield_had_functrace" ]] || set -T
if [[ -n "$__shield_debug_trap_spec" && "$__shield_debug_trap_spec" != "trap -- '__shield_osc133_preexec' DEBUG" ]]; then
  __shield_debug_trap_command="\${__shield_debug_trap_spec#trap -- }"
  __shield_debug_trap_command="\${__shield_debug_trap_command% DEBUG}"
  eval "__shield_user_debug_trap=$__shield_debug_trap_command"
fi
unset __shield_debug_trap_spec __shield_debug_trap_command __shield_had_functrace
unset -f __shield_normalize_prompt_command_part __shield_normalize_prompt_command __shield_prepend_prompt_command __shield_append_prompt_command
unset __shield_prompt_command_normalized
# Arm DEBUG after setup so rcfile commands cannot emit a fake lifecycle before the first prompt.
__shield_initial_prompt=1
trap '__shield_osc133_preexec' DEBUG
unset __shield_initializing_wrapper
`
}
