/** Re-read account selection on every launch in Shield-routed panes with a real claude binary. Missing/empty pointer restores the user’s config; another pane override wins. Create account homes without a login silently and preserve Anthropic auth. Refuse nonabsolute pointers rather than run under the wrong account. */
export function getPosixClaudeShellFunction(): string {
  return `__shield_claude_binary="$(unalias claude 2>/dev/null || :; command -v claude 2>/dev/null || :)"
if [[ -n "\${OSHIELD_CLAUDE_PROFILE_POINTER:-}" && -n "\${__shield_claude_binary:-}" && -x "\${__shield_claude_binary}" ]]; then
  function claude {
    local __shield_claude_home __shield_claude_pointer="\${OSHIELD_CLAUDE_PROFILE_POINTER:-}"
    # Why: a WSL pane's pointer is relative to the guest home, which the host cannot know at spawn.
    case "$__shield_claude_pointer" in '~/'*) __shield_claude_pointer="\${HOME:-}/\${__shield_claude_pointer#??}" ;; esac
    __shield_claude_home="$(cat "$__shield_claude_pointer" 2>/dev/null || :)"
    if [ -n "\${CLAUDE_CONFIG_DIR:-}" ] && [ "$CLAUDE_CONFIG_DIR" != "\${OSHIELD_CLAUDE_INJECTED_CONFIG_DIR:-}" ] &&
      { [ -z "\${OSHIELD_CLAUDE_USER_CONFIG_DIR:-}" ] || [ "\${CLAUDE_CONFIG_DIR%/}" != "\${OSHIELD_CLAUDE_USER_CONFIG_DIR%/}" ]; }; then
      command claude "$@"; return
    fi
    # Why: Shield's value replaced the user's own at spawn, so System default restores theirs.
    if [ -z "$__shield_claude_home" ] && [ -n "\${CLAUDE_CONFIG_DIR:-}" ] && [ -n "\${OSHIELD_CLAUDE_USER_CONFIG_DIR:-}" ]; then
      ( unset OSHIELD_CLAUDE_INJECTED_CONFIG_DIR; export CLAUDE_CONFIG_DIR="$OSHIELD_CLAUDE_USER_CONFIG_DIR"; command claude "$@" ); return
    fi
    if [ -z "$__shield_claude_home" ]; then
      ( unset CLAUDE_CONFIG_DIR OSHIELD_CLAUDE_INJECTED_CONFIG_DIR; command claude "$@" ); return
    fi
    case "$__shield_claude_home" in /*|[A-Za-z]:*) ;; *) return 1 ;; esac
    # Why -m 700: matches the folder Shield's setup creates; a credentials folder stays private.
    [ -d "$__shield_claude_home" ] || mkdir -p -m 700 -- "$__shield_claude_home" 2>/dev/null
    ( export CLAUDE_CONFIG_DIR="$__shield_claude_home" OSHIELD_CLAUDE_INJECTED_CONFIG_DIR="$__shield_claude_home"; command claude "$@" )
  }
fi
unset __shield_claude_binary
`
}

/** Leading newline separates the preceding codex fragment, which has no trailing newline. */
export function getFishClaudeShellFunction(): string {
  return `
set -l __shield_claude_type (type -t claude 2>/dev/null)
if test -n "$OSHIELD_CLAUDE_PROFILE_POINTER"; and test "$__shield_claude_type" = file
  function claude
    # Why: a WSL pane's pointer is relative to the guest home, which the host cannot know at spawn.
    set -l pointer (string replace -r '^~/' "$HOME/" -- "$OSHIELD_CLAUDE_PROFILE_POINTER")
    set -l profile (cat "$pointer" 2>/dev/null)
    set -l own (string trim -r -c / -- "$OSHIELD_CLAUDE_USER_CONFIG_DIR")
    set -l current (string trim -r -c / -- "$CLAUDE_CONFIG_DIR")
    if test -n "$CLAUDE_CONFIG_DIR"; and test "$CLAUDE_CONFIG_DIR" != "$OSHIELD_CLAUDE_INJECTED_CONFIG_DIR"; and begin; test -z "$own"; or test "$current" != "$own"; end
      command claude $argv
      return $status
    end
    if test -z "$profile"; and test -n "$CLAUDE_CONFIG_DIR"; and test -n "$OSHIELD_CLAUDE_USER_CONFIG_DIR"
      env -u OSHIELD_CLAUDE_INJECTED_CONFIG_DIR CLAUDE_CONFIG_DIR="$OSHIELD_CLAUDE_USER_CONFIG_DIR" claude $argv
      return $status
    end
    if test -z "$profile"
      env -u CLAUDE_CONFIG_DIR -u OSHIELD_CLAUDE_INJECTED_CONFIG_DIR claude $argv
      return $status
    end
    if not string match -qr '^(/|[A-Za-z]:)' -- "$profile"
      return 1
    end
    test -d "$profile"; or mkdir -p -m 700 -- "$profile" 2>/dev/null
    env CLAUDE_CONFIG_DIR="$profile" OSHIELD_CLAUDE_INJECTED_CONFIG_DIR="$profile" claude $argv
  end
end
set -e __shield_claude_type
`
}

export function getPowerShellClaudeShellFunction(): string {
  return `$shieldClaudeCommand = Get-Command claude -ErrorAction SilentlyContinue | Select-Object -First 1
if ($env:OSHIELD_CLAUDE_PROFILE_POINTER -and $shieldClaudeCommand -and
    $shieldClaudeCommand.CommandType -in @("Application", "ExternalScript")) {
function Global:claude {
    $names = @('CLAUDE_CONFIG_DIR', 'OSHIELD_CLAUDE_INJECTED_CONFIG_DIR')
    $saved = @{}
    foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
        $shieldClaudeHome = ''
        if ($env:OSHIELD_CLAUDE_PROFILE_POINTER -and (Test-Path -LiteralPath $env:OSHIELD_CLAUDE_PROFILE_POINTER -PathType Leaf)) {
            $shieldClaudeHome = [IO.File]::ReadAllText($env:OSHIELD_CLAUDE_PROFILE_POINTER).TrimEnd()
        }
        # Why the separator swap: Windows names one folder with either separator.
        $own = ("$env:OSHIELD_CLAUDE_USER_CONFIG_DIR" -replace '/', '\\').TrimEnd('\\')
        if ($env:CLAUDE_CONFIG_DIR -and $env:CLAUDE_CONFIG_DIR -ne $env:OSHIELD_CLAUDE_INJECTED_CONFIG_DIR -and
            (-not $own -or ("$env:CLAUDE_CONFIG_DIR" -replace '/', '\\').TrimEnd('\\') -ne $own)) {
            # A value set in this pane, other than the user's own, wins.
        } elseif (-not $shieldClaudeHome) {
            Remove-Item Env:OSHIELD_CLAUDE_INJECTED_CONFIG_DIR -ErrorAction SilentlyContinue
            if ($env:CLAUDE_CONFIG_DIR -and $env:OSHIELD_CLAUDE_USER_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR = $env:OSHIELD_CLAUDE_USER_CONFIG_DIR }
            else { Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue }
        } elseif (-not [IO.Path]::IsPathRooted($shieldClaudeHome)) {
            $global:LASTEXITCODE = 1
            return
        } else {
            if (-not [IO.Directory]::Exists($shieldClaudeHome)) { $null = New-Item -ItemType Directory -Path $shieldClaudeHome -Force -ErrorAction SilentlyContinue }
            $env:CLAUDE_CONFIG_DIR = $shieldClaudeHome
            $env:OSHIELD_CLAUDE_INJECTED_CONFIG_DIR = $shieldClaudeHome
        }
        $binary = Get-Command claude -CommandType Application,ExternalScript -ErrorAction Stop | Select-Object -First 1
        $claudeArgs = @(__ShieldEscapeNativeArgs $binary.Source $args)
        if ($MyInvocation.ExpectingInput) { $input | & $binary.Source @claudeArgs } else { & $binary.Source @claudeArgs }
        $global:LASTEXITCODE = $LASTEXITCODE
    } catch { $global:LASTEXITCODE = 1; Write-Error $_ -ErrorAction Continue }
    finally {
        # Why Remove-Item: on .NET 9+ a $null value (passed as "") creates the variable empty instead of deleting it.
        foreach ($name in $names) {
            if ($null -eq $saved[$name]) { Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue }
            else { [Environment]::SetEnvironmentVariable($name, $saved[$name], 'Process') }
        }
    }
}
}
Remove-Variable shieldClaudeCommand -ErrorAction SilentlyContinue
`
}
