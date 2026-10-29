import { quotePosixShell } from './shell-argument-quoting'

export type PosixCommandPathLookupTarget =
  | { kind: 'literal'; value: string }
  | { kind: 'shell-variable'; name: string }

const SHELL_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

export type PosixCommandPathLookupOptions = {
  /** Skip Windows-mounted PATH entries during WSL search, not after the first hit: otherwise a Windows CLI masks a later guest CLI.
   * Use mount metadata, not /mnt spelling, because automount roots vary and ordinary Linux may use /mnt. */
  skipWindowsMountDirs?: boolean
}

export function buildPosixCommandPathLookupScript(
  target: PosixCommandPathLookupTarget,
  options: PosixCommandPathLookupOptions = {}
): string {
  const commandAssignment = buildCommandAssignment(target)
  // Recognize drvfs/9p/virtiofs independent of mount root. Cache the table once per shell with ${x+set}, including empty results:
  // callers loop over every agent, and one awk fork each previously spent 36 probes’ 10s budget.
  const mountPrelude = options.skipWindowsMountDirs
    ? [
        '[ "${_shield_win_mounts+set}" = set ] || _shield_win_mounts=$(awk \'$3 == "drvfs" || $3 == "9p" || $3 == "virtiofs" { print $2 }\' /proc/mounts 2>/dev/null)'
      ]
    : []
  const skipMountComponent = options.skipWindowsMountDirs
    ? [
        '      for _shield_win_mount in $_shield_win_mounts; do',
        '        case "$_shield_lookup_component/" in',
        '          "$_shield_win_mount"/*) _shield_lookup_component= ;;',
        '        esac',
        '      done',
        '      if [ -z "$_shield_lookup_component" ]; then',
        '        [ -n "$_shield_lookup_has_more" ] || break',
        '        continue',
        '      fi'
      ]
    : []
  // Shell command resolution can be masked by aliases, functions, and builtins, so inspect PATH.
  return [
    `_shield_lookup_command=${commandAssignment}`,
    'resolved=',
    ...mountPrelude,
    'case "$_shield_lookup_command" in',
    '  */*)',
    '    case "$_shield_lookup_command" in',
    '      /*) _shield_lookup_candidate=$_shield_lookup_command ;;',
    '      *) _shield_lookup_candidate=${PWD%/}/$_shield_lookup_command ;;',
    '    esac',
    '    if [ -x "$_shield_lookup_candidate" ] && [ ! -d "$_shield_lookup_candidate" ]; then',
    '      resolved=$_shield_lookup_candidate',
    '    fi',
    '    ;;',
    '  *)',
    '    _shield_lookup_remaining=${PATH-}',
    '    while :; do',
    '      case "$_shield_lookup_remaining" in',
    '        *:*)',
    '          _shield_lookup_component=${_shield_lookup_remaining%%:*}',
    '          _shield_lookup_remaining=${_shield_lookup_remaining#*:}',
    '          _shield_lookup_has_more=1',
    '          ;;',
    '        *)',
    '          _shield_lookup_component=$_shield_lookup_remaining',
    '          _shield_lookup_has_more=',
    '          ;;',
    '      esac',
    ...skipMountComponent,
    '      [ -n "$_shield_lookup_component" ] || _shield_lookup_component=.',
    '      case "$_shield_lookup_component" in',
    '        /*) _shield_lookup_candidate=$_shield_lookup_component/$_shield_lookup_command ;;',
    '        *) _shield_lookup_candidate=${PWD%/}/$_shield_lookup_component/$_shield_lookup_command ;;',
    '      esac',
    '      if [ -x "$_shield_lookup_candidate" ] && [ ! -d "$_shield_lookup_candidate" ]; then',
    '        resolved=$_shield_lookup_candidate',
    '        break',
    '      fi',
    '      [ -n "$_shield_lookup_has_more" ] || break',
    '    done',
    '    ;;',
    'esac'
  ].join('\n')
}

function buildCommandAssignment(target: PosixCommandPathLookupTarget): string {
  if (target.kind === 'literal') {
    return quotePosixShell(target.value)
  }
  if (!SHELL_VARIABLE_NAME_PATTERN.test(target.name)) {
    throw new Error(`Invalid shell variable name: ${target.name}`)
  }
  return `\${${target.name}-}`
}
