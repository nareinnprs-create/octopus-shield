// Typed OMP needs Shield's status extension explicitly; preserve PI_CODING_AGENT_DIR as the user's mutable auth/config/session home.

const OMP_SUBCOMMANDS = [
  '__complete',
  'acp',
  'agents',
  'auth-broker',
  'auth-gateway',
  'bench',
  'commit',
  'completions',
  'config',
  'dry-balance',
  'gallery',
  'grep',
  'grievances',
  'install',
  'join',
  'models',
  'plugin',
  'read',
  'say',
  'search',
  'setup',
  'shell',
  'ssh',
  'stats',
  'tiny-models',
  'token',
  'ttsr',
  'update',
  'usage',
  'worktree',
  'q',
  'wt'
] as const

export function getPosixOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join('|')
  return `# Why: OMP does not auto-load Shield's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
__shield_omp_should_skip_extension() {
  case "\${1:-}" in
    'help'|'--help'|'-h'|'--version'|'-v') return 0 ;;
    ${subcommands}) return 0 ;;
  esac
  return 1
}
__shield_omp_cwd_is_usable() {
  local __shield_physical_cwd
  [[ -x . ]] || return 1
  if [[ -n "\${PWD:-}" && -d "\${PWD:-}" ]]; then
    [[ "\${PWD}" -ef . ]]
  else
    # Why compare the path: shell builtins can print a cached path for a deleted cwd.
    __shield_physical_cwd="$(builtin pwd -P 2>/dev/null)" || return 1
    [[ -d "$__shield_physical_cwd" && "$__shield_physical_cwd" -ef . ]]
  fi
}
__shield_omp_invoke() {
  local __shield_use_extension="$1"
  shift
  if [[ $__shield_use_extension -eq 1 && -n "\${OSHIELD_OMP_STATUS_EXTENSION:-}" && -f "\${OSHIELD_OMP_STATUS_EXTENSION}" ]]; then
    if [[ "\${1:-}" == "launch" ]]; then
      shift
      command omp launch --extension "\${OSHIELD_OMP_STATUS_EXTENSION}" "$@"
    else
      command omp --extension "\${OSHIELD_OMP_STATUS_EXTENSION}" "$@"
    fi
  else
    command omp "$@"
  fi
}
__shield_omp() {
  local __shield_use_extension=1
  __shield_omp_should_skip_extension "\${1:-}" && __shield_use_extension=0
  if ! __shield_omp_cwd_is_usable; then
    local __shield_logical_cwd="\${PWD:-\${OSHIELD_WORKTREE_PATH:-\${OSHIELD_ROOT_PATH:-}}}"
    # Why: a restored shell can retain the deleted directory inode after its path is recreated.
    (
      if [[ -z "$__shield_logical_cwd" ]]; then
        printf 'Shield: OMP cannot start because no terminal working directory is available. Open a new terminal in an existing directory.\\n' >&2
        return 1
      fi
      if ! builtin cd -P -- "$__shield_logical_cwd" 2>/dev/null; then
        printf 'Shield: OMP cannot access the terminal working directory "%s". Open a new terminal in an existing directory.\\n' "$__shield_logical_cwd" >&2
        return 1
      fi
      __shield_omp_invoke "$__shield_use_extension" "$@"
    )
  else
    __shield_omp_invoke "$__shield_use_extension" "$@"
  fi
}
if [[ -n "\${OSHIELD_OMP_STATUS_EXTENSION:-}" ]]; then
  # Why the function reserved word: it suppresses alias expansion of the name, which
  # an \`alias omp\` otherwise rewrites at parse time, aborting the rest of the file.
  function omp { __shield_omp "$@"; }
fi
`
}

export function getPowerShellOmpShellWrapper(): string {
  const subcommands = OMP_SUBCOMMANDS.map((value) => `'${value}'`).join(', ')
  return `# Why: OMP does not auto-load Shield's managed status extension; wrap only
# interactive launch invocations so subcommands such as \`omp config\` keep
# their normal argv shape.
function Global:__ShieldOmpShouldSkipExtension {
    param([string]$Name)
    $skip = @("help", "--help", "-h", "--version", "-v") + @(${subcommands})
    return $skip -contains $Name
}
if ($env:OSHIELD_OMP_STATUS_EXTENSION) {
    function Global:omp {
        $shieldUseExtension = -not (__ShieldOmpShouldSkipExtension -Name ([string]($args[0])))
        $shieldStatus = 0
        $shieldCommand = Get-Command omp -CommandType Application,ExternalScript -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $shieldCommand) {
            Write-Error "omp executable not found"
            $shieldStatus = 127
        } elseif ($shieldUseExtension -and $env:OSHIELD_OMP_STATUS_EXTENSION -and
            (Test-Path -LiteralPath $env:OSHIELD_OMP_STATUS_EXTENSION)) {
            if ($args.Count -gt 0 -and $args[0] -eq "launch") {
                $shieldLaunchArgs = @($args | Select-Object -Skip 1)
                & $shieldCommand.Source launch --extension $env:OSHIELD_OMP_STATUS_EXTENSION @shieldLaunchArgs
            } else {
                & $shieldCommand.Source --extension $env:OSHIELD_OMP_STATUS_EXTENSION @args
            }
            $shieldStatus = $LASTEXITCODE
        } else {
            & $shieldCommand.Source @args
            $shieldStatus = $LASTEXITCODE
        }

        $global:LASTEXITCODE = $shieldStatus
    }
}
`
}
