// Embed launch-prep/--no-daemon wrappers on all hosts. Codex 0.156+ otherwise shares CODEX_HOME servers with the first tab’s Shield hooks/env and lifetime (#22873). agents/queue/--remote require sharing; any -c opts out.
const CODEX_SHARED_SERVER_ARGS = ['agents', 'queue', '--remote'] as const
export const CODEX_NO_DAEMON_SKIP_ARGS = [...CODEX_SHARED_SERVER_ARGS, '--no-daemon'] as const
const argPattern = (args: readonly string[]): string => `^(${args.join('|')}|--remote=.*)$`
const CODEX_SHARED_SERVER_ARG_PATTERN = argPattern(CODEX_SHARED_SERVER_ARGS)
const CODEX_NO_DAEMON_SKIP_ARG_PATTERN = argPattern(CODEX_NO_DAEMON_SKIP_ARGS)

/** Restore nonsecret Shield caller identity stripped by inherit=core (#25775). set overrides inherit/exclude but include_only still wins; never send tokens through locally readable argv. */
export const CODEX_COMMAND_IDENTITY_ENV_KEYS = [
  'OSHIELD_TERMINAL_HANDLE',
  'OSHIELD_PANE_KEY',
  'OSHIELD_WORKTREE_ID',
  'OSHIELD_WORKSPACE_ID',
  'OSHIELD_USER_DATA_PATH'
] as const

// Skip apostrophes: TOML literals cannot hold them and Codex parse fallback may truncate paths; missing identity is safer than wrong identity.
const identitySetArg = (key: string, value: string): string =>
  `shell_environment_policy.set.${key}='${value}'`

export function getPosixCodexShellLaunchPreflight(): string {
  return `# Why: a typed alias expands inside the shell, after pane launch prep.
# Why unalias inside the substitution: an alias named codex makes command -v
# report the alias text, and the subshell leaves the user's own alias intact.
# Why || : twice — zsh alone aborts inside the substitution, but every shell's
# assignment adopts its exit status, so an absent codex trips set -e in bash too.
__shield_codex_binary="$(unalias codex 2>/dev/null || :; command -v codex 2>/dev/null || :)"
if [[ -n "\${__shield_codex_binary:-}" && -x "\${__shield_codex_binary}" ]]; then
  # Why the function reserved word: it suppresses alias expansion of the name,
  # which otherwise rewrites this header at parse time and aborts the whole file.
  function codex {
    # Why local: zsh's warn_create_global warns for each global a function creates.
    local __shield_codex_arg __shield_codex_isolate="\${OSHIELD_CODEX_ISOLATE:-1}" __shield_codex_identity="\${OSHIELD_CODEX_ISOLATE:-1}"
    if [[ -n "\${OSHIELD_CODEX_LAUNCH_PREFLIGHT:-}" && -x "\${OSHIELD_CODEX_LAUNCH_PREFLIGHT}" ]]; then
      "\${OSHIELD_CODEX_LAUNCH_PREFLIGHT}" agent hooks prepare-codex >/dev/null 2>&1 || :
    fi
    for __shield_codex_arg in "$@"; do
      case "$__shield_codex_arg" in
        --no-daemon) __shield_codex_isolate=0 ;;
        ${CODEX_SHARED_SERVER_ARGS.join('|')}|--remote=*) __shield_codex_isolate=0 __shield_codex_identity=0 ;;
      esac
    done
    if [[ "$__shield_codex_identity" != 0 ]]; then
${CODEX_COMMAND_IDENTITY_ENV_KEYS.map((key) => `      [[ -z "\${${key}:-}" || "\${${key}}" == *"'"* ]] || set -- -c "${identitySetArg(key, `\${${key}}`)}" "$@"`).join('\n')}
    fi
    # Why probe every launch: a cached answer goes stale across an upgrade, and 0.155 and older exit 2 on the flag.
    if [[ "$__shield_codex_isolate" != 0 ]]; then
      case "$(command codex --help 2>/dev/null </dev/null)" in *--no-daemon*) set -- --no-daemon "$@" ;; esac
    fi
    command codex "$@"
  }
fi
unset __shield_codex_binary
`
}

export function getFishCodexShellLaunchPreflight(): string {
  return `# Why captured: an unquoted (type -t codex) expands to zero words when codex is
# absent, leaving "test = file" — fish then errors instead of failing closed.
# Quoting in place is not the fix; fish never substitutes inside double quotes.
set -l __shield_codex_type (type -t codex 2>/dev/null)
if test "$__shield_codex_type" = file
  function codex
    if test -x "$OSHIELD_CODEX_LAUNCH_PREFLIGHT"
      command "$OSHIELD_CODEX_LAUNCH_PREFLIGHT" agent hooks prepare-codex >/dev/null 2>&1; or true
    end
    if test "$OSHIELD_CODEX_ISOLATE" != 0; and not string match -qr -- '${CODEX_SHARED_SERVER_ARG_PATTERN}' $argv
${CODEX_COMMAND_IDENTITY_ENV_KEYS.map((key) => `      test -n "$${key}"; and not string match -q -- "*'*" "$${key}"; and set argv -c "${identitySetArg(key, `$${key}`)}" $argv`).join('\n')}
    end
    if test "$OSHIELD_CODEX_ISOLATE" != 0; and not string match -qr -- '${CODEX_NO_DAEMON_SKIP_ARG_PATTERN}' $argv; and command codex --help 2>/dev/null </dev/null | string match -q -- '*--no-daemon*'
      set argv --no-daemon $argv
    end
    command codex $argv
  end
end
set -e __shield_codex_type`
}

// Keep the identity loop compact to share PowerShell’s command-line budget with startup commands.
export function getPowerShellCodexShellLaunchPreflight(): string {
  return `$shieldCodexCommand = Get-Command codex -ErrorAction SilentlyContinue | Select-Object -First 1
if ($shieldCodexCommand -and
    $shieldCodexCommand.CommandType -in @("Application", "ExternalScript")) {
    function Global:codex {
        $shieldCodexExecutable = Get-Command codex -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $shieldCodexExecutable) {
            Write-Error "codex executable not found"
            $global:LASTEXITCODE = 127
            return
        }
        $shieldCodexFlags = @()
        # Why try/catch: under the user's $ErrorActionPreference = 'Stop', a failing prep or probe must not abort the launch.
        if ($env:OSHIELD_CODEX_LAUNCH_PREFLIGHT) {
            try {
                & $env:OSHIELD_CODEX_LAUNCH_PREFLIGHT agent hooks prepare-codex *> $null
            } catch {
            }
        }
        if ($env:OSHIELD_CODEX_ISOLATE -ne '0' -and -not (@($args) -cmatch '${CODEX_NO_DAEMON_SKIP_ARG_PATTERN}')) {
            try {
                if ((& $shieldCodexExecutable.Source --help 2>$null) -match '--no-daemon') {
                    $shieldCodexFlags = @('--no-daemon')
                }
            } catch {
            }
        }
        $shieldCodexIdentity = @()
        if ($env:OSHIELD_CODEX_ISOLATE -ne '0' -and -not (@($args) -cmatch '${CODEX_SHARED_SERVER_ARG_PATTERN}')) {
            foreach ($k in ${CODEX_COMMAND_IDENTITY_ENV_KEYS.map((key) => `'${key}'`).join(',')}) { $v = [Environment]::GetEnvironmentVariable($k); if ($v -and -not $v.Contains("'")) { $shieldCodexIdentity += '-c', "${identitySetArg('$k', '$v')}" } }
        }
        $shieldCodexArgs = @(__ShieldEscapeNativeArgs $shieldCodexExecutable.Source (@($shieldCodexIdentity) + @($args)))
        # Why: a native command inside a function never sees the function's pipeline input on its own.
        if ($MyInvocation.ExpectingInput) {
            $input | & $shieldCodexExecutable.Source @shieldCodexFlags @shieldCodexArgs
        } else {
            & $shieldCodexExecutable.Source @shieldCodexFlags @shieldCodexArgs
        }
        $global:LASTEXITCODE = $LASTEXITCODE
    }
}
Remove-Variable shieldCodexCommand -ErrorAction SilentlyContinue`
}
