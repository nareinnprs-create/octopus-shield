export const BASH_PROMPT_COMMAND_COMPOSITION_BLOCK = `__shield_normalize_prompt_command_part() {
  local __shield_value="$1" __shield_output_name="$2" __shield_character __shield_chunk
  local __shield_value_length=\${#1} __shield_suffix_length=0 __shield_backslash_length=0
  local __shield_output_length __shield_scan_start
  while (( __shield_value_length - __shield_suffix_length >= 1024 )); do
    __shield_scan_start=$(( __shield_value_length - __shield_suffix_length - 1024 ))
    __shield_chunk="\${__shield_value:__shield_scan_start:1024}"
    case "$__shield_chunk" in
      *[!$' \\t\\n;']*) break ;;
      *) __shield_suffix_length=$(( __shield_suffix_length + 1024 )) ;;
    esac
  done
  while (( __shield_suffix_length < __shield_value_length )); do
    __shield_character="\${__shield_value: -__shield_suffix_length - 1:1}"
    case "$__shield_character" in
      ' '|$'\\t'|$'\\n'|';') __shield_suffix_length=$(( __shield_suffix_length + 1 )) ;;
      *) break ;;
    esac
  done
  __shield_output_length=$(( \${#__shield_value} - __shield_suffix_length ))
  while (( __shield_output_length - __shield_backslash_length >= 1024 )); do
    __shield_scan_start=$(( __shield_output_length - __shield_backslash_length - 1024 ))
    __shield_chunk="\${__shield_value:__shield_scan_start:1024}"
    case "$__shield_chunk" in
      *[!\\\\]*) break ;;
      *) __shield_backslash_length=$(( __shield_backslash_length + 1024 )) ;;
    esac
  done
  while (( __shield_backslash_length < __shield_output_length )); do
    __shield_character="\${__shield_value:__shield_output_length - __shield_backslash_length - 1:1}"
    [[ "$__shield_character" == '\\' ]] || break
    __shield_backslash_length=$(( __shield_backslash_length + 1 ))
  done
  # Preserve the first separator when an odd backslash run escapes it.
  if (( __shield_suffix_length > 0 && __shield_backslash_length % 2 == 1 )); then
    __shield_suffix_length=$(( __shield_suffix_length - 1 ))
    __shield_backslash_length=0
  fi
  __shield_output_length=$(( \${#__shield_value} - __shield_suffix_length ))
  __shield_value="\${__shield_value:0:__shield_output_length}"
  # Bash 4.4-5.0 scalar prompt evaluation preserves an odd terminal backslash.
  if (( __shield_suffix_length == 0 && ((BASH_VERSINFO[0] == 4 && BASH_VERSINFO[1] >= 4) || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] == 0)) && __shield_backslash_length % 2 == 1 )); then
    __shield_value="$__shield_value\\\\"
  fi
  printf -v "$__shield_output_name" '%s' "$__shield_value"
}
__shield_restore_prompt_status() {
  return "$1"
}
__shield_update_user_debug_trap() {
  local __shield_debug_trap_spec="$1" __shield_unchanged_debug_trap_spec="$2"
  local __shield_debug_trap_command
  [[ "$__shield_debug_trap_spec" != "$__shield_unchanged_debug_trap_spec" ]] || return 0
  [[ "$__shield_debug_trap_spec" != "trap -- '__shield_osc133_preexec' DEBUG" ]] || return 0
  if [[ -z "$__shield_debug_trap_spec" ]]; then
    __shield_user_debug_trap=""
    unset __shield_chained_debug_trap
    return 0
  fi
  __shield_debug_trap_command="\${__shield_debug_trap_spec#trap -- }"
  __shield_debug_trap_command="\${__shield_debug_trap_command% DEBUG}"
  eval "__shield_user_debug_trap=$__shield_debug_trap_command"
  unset __shield_chained_debug_trap
}
__shield_run_user_debug_trap() {
  if [[ -n "\${__shield_user_debug_trap:-}" ]]; then
    eval "$__shield_user_debug_trap" || true
  fi
}
__shield_adopt_outer_debug_trap() {
  local __shield_debug_trap_spec="\${__shield_outer_debug_trap_spec:-}"
  unset __shield_outer_debug_trap_spec
  __shield_update_user_debug_trap "$__shield_debug_trap_spec" "trap -- '__shield_osc133_preexec' DEBUG"
}
__shield_run_prompt_command_array() {
  local __shield_exit_code="\${__shield_prompt_status:-$?}" __shield_prompt_part __shield_prompt_index __shield_user_count
  local __shield_suffix_part
  local __shield_final_prompt_command
  local __shield_in_prompt_dispatch=1 __shield_dispatching_user_prompt_command=""
  unset __shield_prompt_status
  __shield_adopt_outer_debug_trap
  trap '__shield_osc133_preexec' DEBUG
  for __shield_prompt_part in "\${__shield_prompt_command_prefix[@]+"\${__shield_prompt_command_prefix[@]}"}"; do
    if (( __shield_exit_code == 0 )); then
      eval "$__shield_prompt_part"
    else
      __shield_restore_prompt_status "$__shield_exit_code" || eval "$__shield_prompt_part"
    fi
  done
  __shield_user_count=0
  for __shield_prompt_part in "\${__shield_prompt_command_array[@]+"\${__shield_prompt_command_array[@]}"}"; do
    __shield_user_count=$(( __shield_user_count + 1 ))
  done
  for (( __shield_prompt_index = 0; __shield_prompt_index + 1 < __shield_user_count; __shield_prompt_index++ )); do
    __shield_prompt_part="\${__shield_prompt_command_array[__shield_prompt_index]}"
    __shield_dispatching_user_prompt_command=1
    if (( __shield_exit_code == 0 )); then
      eval "$__shield_prompt_part"
    else
      __shield_restore_prompt_status "$__shield_exit_code" || eval "$__shield_prompt_part"
    fi
    __shield_dispatching_user_prompt_command=""
  done
  if (( __shield_user_count > 0 )); then
    __shield_prompt_part="\${__shield_prompt_command_array[__shield_user_count - 1]}"
    # Why: keep the final user hook and Shield suffixes in one status-preserving eval.
    __shield_final_prompt_command='eval "$__shield_prompt_part"'
    for __shield_suffix_part in "\${__shield_prompt_command_suffix[@]+"\${__shield_prompt_command_suffix[@]}"}"; do
      __shield_final_prompt_command+=$'\\n'"$__shield_suffix_part"
    done
    __shield_dispatching_user_prompt_command=1
    if (( __shield_exit_code == 0 )); then
      eval "$__shield_final_prompt_command"
    else
      __shield_restore_prompt_status "$__shield_exit_code" || eval "$__shield_final_prompt_command"
    fi
    __shield_dispatching_user_prompt_command=""
  else
    for __shield_prompt_part in "\${__shield_prompt_command_suffix[@]+"\${__shield_prompt_command_suffix[@]}"}"; do
      if (( __shield_exit_code == 0 )); then
        eval "$__shield_prompt_part"
      else
        __shield_restore_prompt_status "$__shield_exit_code" || eval "$__shield_prompt_part"
      fi
    done
  fi
  return "$__shield_exit_code"
}
__shield_finish_legacy_prompt_dispatch() {
  local __shield_suffix_part
  if [[ -n "\${__shield_in_prompt_command:-}" ]]; then
    for __shield_suffix_part in "\${__shield_prompt_command_suffix[@]+"\${__shield_prompt_command_suffix[@]}"}"; do
      eval "$__shield_suffix_part"
    done
  fi
}
__shield_normalize_prompt_command() {
  [[ -z "\${__shield_prompt_command_normalized:-}" ]] || return 0
  local __shield_prompt_part
  local -a __shield_normalized=()
  for __shield_prompt_part in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
    __shield_normalize_prompt_command_part "$__shield_prompt_part" __shield_prompt_part
    [[ -n "$__shield_prompt_part" ]] && __shield_normalized+=("$__shield_prompt_part")
  done
  __shield_prompt_command_normalized=1
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("\${__shield_normalized[@]+"\${__shield_normalized[@]}"}")
  else
    __shield_prompt_command_array=("\${__shield_normalized[@]+"\${__shield_normalized[@]}"}")
    __shield_prompt_command_prefix=()
    __shield_prompt_command_suffix=()
    unset PROMPT_COMMAND
    # Why: PID scope distinguishes legacy prompt dispatch from ordinary user command text.
    __shield_prompt_status_variable="__shield_prompt_status_$$"
    __shield_prompt_status_capture_command="$__shield_prompt_status_variable=\\$?"
    __shield_prompt_status_value="\\\${$__shield_prompt_status_variable}"
    # Why: a changed DEBUG trap misses the capture command, and bash <= 4.3 reverts traps set in functions.
    PROMPT_COMMAND="$__shield_prompt_status_capture_command; __shield_in_legacy_prompt_wrapper=1; __shield_prompt_status=$__shield_prompt_status_value"'; __shield_prompt_had_functrace=""; if [[ -o functrace ]]; then __shield_prompt_had_functrace=1; set +T; fi; __shield_outer_debug_trap_spec="$(trap -p DEBUG)"; [[ -z "$__shield_prompt_had_functrace" ]] || set -T; unset __shield_prompt_had_functrace; __shield_run_prompt_command_array; __shield_finish_legacy_prompt_dispatch; trap __shield_osc133_preexec DEBUG; unset __shield_in_legacy_prompt_wrapper'
  fi
}
__shield_prepend_prompt_command() {
  local command="$1"
  __shield_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND=("$command" "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}")
  else
    __shield_prompt_command_prefix=("$command" "\${__shield_prompt_command_prefix[@]+"\${__shield_prompt_command_prefix[@]}"}")
  fi
}
__shield_append_prompt_command() {
  local command="$1"
  __shield_normalize_prompt_command
  if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
    PROMPT_COMMAND+=("$command")
  else
    __shield_prompt_command_suffix+=("$command")
  fi
}`
