import { SHELL_STARTUP_FEATURE_ENV } from './shell-startup-features'
import { POSIX_SHELL_STARTUP_COMMAND_ENV } from './pty/posix-shell-startup-command'

export const ZSH_WRAPPER_DIR_MARKER_FILE = '.shield-shell-wrapper'

export const ZSH_WRAPPER_DIR_MARKER_CONTENT = `# Shield-generated zsh startup wrapper directory.
# Its presence is how Shield recognises its own wrapper dir instead of treating it
# as the user's ZDOTDIR. Do not edit; the whole directory is regenerated.
`

// Consume feature env before user config so children cannot inherit the selection.
export const ZSH_FEATURE_CHANNEL_BLOCK = `builtin typeset -ga _shield_shell_features
_shield_shell_features=(\${(s:,:)\${${SHELL_STARTUP_FEATURE_ENV}:-}})
builtin unset ${SHELL_STARTUP_FEATURE_ENV}
# Consume now: user config can drop the deferred hook, leaving exported history state to leak into children.
builtin typeset -g _shield_histfile="\${OSHIELD_HISTFILE:-}"
builtin unset OSHIELD_HISTFILE
__shield_has_feature() { (( \${_shield_shell_features[(Ie)$1]} )) }`

export const BASH_FEATURE_CHANNEL_BLOCK = `_shield_shell_features=",\${${SHELL_STARTUP_FEATURE_ENV}:-},"
builtin unset ${SHELL_STARTUP_FEATURE_ENV}
__shield_has_feature() { [[ "$_shield_shell_features" == *",$1,"* ]]; }`

export const SHELL_STARTUP_IDENTITY_MARKER_BLOCK = `__shield_has_feature identity && printf "\\033]777;shield-shell-start:%s\\007" "$$"`

// Restore and consume ZDOTDIR before user startup files; reject stale Shield wrapper paths.
export const ZSH_ZDOTDIR_HANDBACK_BLOCK = `__shield_usable_zdotdir() {
  [[ -n "\${1:-}" ]] || return 1
  [[ "$1" != */shell-ready/zsh ]] || return 1
  [[ ! -f "$1/${ZSH_WRAPPER_DIR_MARKER_FILE}" ]] || return 1
  # Reject empty config roots so stale wrapper state cannot hide the user's real .zshenv.
  local _shield_startup_file
  for _shield_startup_file in .zshenv .zshrc .zprofile .zlogin; do
    [[ -r "$1/$_shield_startup_file" ]] && return 0
  done
  return 1
}
if __shield_usable_zdotdir "\${OSHIELD_ORIG_ZDOTDIR:-}"; then
  builtin export ZDOTDIR="$OSHIELD_ORIG_ZDOTDIR"
else
  builtin unset ZDOTDIR
fi
builtin unset OSHIELD_ORIG_ZDOTDIR OSHIELD_ZSHENV_SOURCE_DIR
builtin unfunction __shield_usable_zdotdir`

// Parse registration before user code can switch emulation; source at top level to preserve scope.
export const ZSH_USER_ZSHENV_SOURCE_BLOCK = `{
  builtin typeset _shield_user_zshenv="\${ZDOTDIR-$HOME}/.zshenv"
  [[ ! -r "$_shield_user_zshenv" ]] || builtin source -- "$_shield_user_zshenv"
} always {
  builtin unset _shield_user_zshenv
  if (( ! $+_shield_deferred_init_done )); then
    builtin typeset -ag precmd_functions
    (( \${precmd_functions[(Ie)__shield_deferred_init]} )) || precmd_functions+=(__shield_deferred_init)
    __shield_arm_deferred_line_init
  fi
}`

export { BASH_PROMPT_COMMAND_COMPOSITION_BLOCK } from './bash-prompt-command-composition'

// zle-line-init runs after line editing starts; emit before user hooks can fail and suppress readiness.
export function getZshShellReadyMarkerRegistrationBlock(
  escapedMarker: string,
  supportsStartupCommand = false
): string {
  const markerBlock = supportsStartupCommand
    ? `  if [[ "\${__shield_emit_ready_marker-1}" == 1 ]]; then
    printf "${escapedMarker}"
  fi`
    : `  printf "${escapedMarker}"`
  const startupCommandBlock = supportsStartupCommand
    ? `
  if (( \${+${POSIX_SHELL_STARTUP_COMMAND_ENV}} )); then
    BUFFER="\$${POSIX_SHELL_STARTUP_COMMAND_ENV}"
    CURSOR=\${#BUFFER}
    builtin unset ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    zle accept-line
  fi`
    : ''
  return `# Preserve the original user widget across re-sourcing; builtin/completion widgets cannot chain as plain functions.
if [[ "\${widgets[zle-line-init]:-}" == "user:__shield_prompt_mark" ]]; then
  :
elif (( \${+widgets[zle-line-init]} )) && [[ "\${widgets[zle-line-init]}" == user:* ]]; then
  __shield_prev_line_init_fn="\${widgets[zle-line-init]#user:}"
else
  __shield_prev_line_init_fn=""
fi
__shield_prompt_mark() {
${markerBlock}
  # Call as a function so $WIDGET remains zle-line-init for add-zle-hook-widget dispatchers.
  if [[ -n "\${__shield_prev_line_init_fn:-}" ]]; then
    "\${__shield_prev_line_init_fn}" "$@"
  fi${startupCommandBlock}
}
zle -N zle-line-init __shield_prompt_mark`.replace(/\n\n}\n$/, '\n}\n')
}

// fish_prompt runs after config but before bracketed-paste mode; PostReadyFlushGate covers that gap.
export function getFishShellReadyInitCommand(
  escapedMarker: string,
  emitReadyMarker = true,
  supportsStartupCommand = false
): string {
  const readyMarkerBlock = emitReadyMarker ? `  builtin printf "${escapedMarker}"\n` : ''
  const startupCommandBlock = supportsStartupCommand
    ? `  if set -q ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    set -l __shield_command "\$${POSIX_SHELL_STARTUP_COMMAND_ENV}"
    set -e ${POSIX_SHELL_STARTUP_COMMAND_ENV}
    builtin printf '%s\\n' "$__shield_command"
    eval "$__shield_command"
    return $status
  end\n`
    : ''
  return `function __shield_shell_ready_marker --on-event fish_prompt
${readyMarkerBlock}  functions -e __shield_shell_ready_marker
${startupCommandBlock}end`
}
