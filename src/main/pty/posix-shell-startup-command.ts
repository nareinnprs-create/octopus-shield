import { basename, win32 as pathWin32 } from 'node:path'

export const POSIX_SHELL_STARTUP_COMMAND_ENV = 'OSHIELD_POSIX_SHELL_STARTUP_COMMAND'

export function supportsPosixShellStartupCommand(shellPath: string): boolean {
  const shellName = pathWin32.basename(basename(shellPath)).toLowerCase()
  return shellName === 'bash' || shellName === 'zsh' || shellName === 'fish'
}

export function getBashStartupCommandPromptBlock(): string {
  return `if [[ \${${POSIX_SHELL_STARTUP_COMMAND_ENV}+present} == present ]]; then
  __shield_remove_startup_command_prompt_hook() {
    local __shield_item
    local -a __shield_remaining=()
    if (( BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1) )); then
      for __shield_item in "\${PROMPT_COMMAND[@]+"\${PROMPT_COMMAND[@]}"}"; do
        [[ "$__shield_item" == "__shield_run_startup_command" ]] || __shield_remaining+=("$__shield_item")
      done
      PROMPT_COMMAND=("\${__shield_remaining[@]+"\${__shield_remaining[@]}"}")
    else
      for __shield_item in "\${__shield_prompt_command_suffix[@]+"\${__shield_prompt_command_suffix[@]}"}"; do
        [[ "$__shield_item" == "__shield_run_startup_command" ]] || __shield_remaining+=("$__shield_item")
      done
      __shield_prompt_command_suffix=("\${__shield_remaining[@]+"\${__shield_remaining[@]}"}")
    fi
  }
  __shield_run_startup_command() {
    local __shield_command="$${POSIX_SHELL_STARTUP_COMMAND_ENV}" __shield_status
    unset ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    __shield_remove_startup_command_prompt_hook
    unset -f __shield_remove_startup_command_prompt_hook
    builtin history -s "$__shield_command" 2>/dev/null || true
    builtin printf '%s\n' "$__shield_command"
    eval "$__shield_command"
    __shield_status=$?
    unset -f __shield_run_startup_command
    return "$__shield_status"
  }
  __shield_append_prompt_command "__shield_run_startup_command"
fi`
}
