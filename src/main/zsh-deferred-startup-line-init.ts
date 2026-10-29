// Stock zshrc can replace line-init after user config clears the prompt-hook array.
export const ZSH_DEFERRED_LINE_INIT_BLOCK = `__shield_deferred_line_init() {
  builtin emulate -L zsh
  (( \${+functions[__shield_deferred_init]} )) || return 0
  local __shield_direct_line_init=0
  [[ "\${widgets[zle-line-init]:-}" == user:__shield_deferred_line_init ]] && __shield_direct_line_init=1
  __shield_deferred_init
  if (( __shield_direct_line_init && \${+widgets[zle-line-init]} )); then
    zle zle-line-init "$@"
  elif [[ "\${widgets[zle-line-init]:-}" == user:__shield_prompt_mark ]]; then
    local __shield_prev_line_init_fn=""
    __shield_prompt_mark "$@"
  fi
}
# Run after user prompt hooks without copying their function metadata.
__shield_deferred_sched_init() {
  local __shield_prompt_status=$?
  builtin emulate -L zsh
  (( \${+functions[__shield_deferred_init]} )) && __shield_deferred_init
  builtin unset __shield_deferred_sched_armed
  builtin unfunction __shield_deferred_sched_init
  return $__shield_prompt_status
}
__shield_arm_deferred_line_init() {
  builtin emulate -L zsh
  if [[ "\${widgets[zle-line-init]:-}" != user:__shield_deferred_line_init ]]; then
    if (( \${+widgets[zle-line-init]} )); then
      zle -A zle-line-init __shield_saved_line_init
    fi
    zle -N zle-line-init __shield_deferred_line_init
  fi
  if (( ! $+__shield_deferred_sched_armed )) && builtin zmodload -F zsh/sched b:sched 2>/dev/null; then
    builtin sched +0 __shield_deferred_sched_init && builtin typeset -g __shield_deferred_sched_armed=1
  fi
}`

// Restore the prior widget before the readiness hook captures it.
export const ZSH_DEFERRED_LINE_INIT_RETIRE_BLOCK = `  if (( \${+widgets[__shield_saved_line_init]} )); then
    if [[ "\${widgets[zle-line-init]:-}" == user:__shield_deferred_line_init ]]; then
      zle -A __shield_saved_line_init zle-line-init
    fi
    zle -D __shield_saved_line_init
  elif [[ "\${widgets[zle-line-init]:-}" == user:__shield_deferred_line_init ]]; then
    zle -D zle-line-init
  fi`

// Plugin-copied callbacks stay inert after startup through their own guards.
export const ZSH_DEFERRED_LINE_INIT_CLEANUP_BLOCK = `  (( $+__shield_deferred_sched_armed )) || builtin unfunction __shield_deferred_sched_init`
