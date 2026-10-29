// Remember repeatable deployment refusals per app version; host-fixable settings must be reprobed.

export class OctopodHostUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OctopodHostUnsupportedError'
  }
}

export class OctopodArtifactsUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OctopodArtifactsUnavailableError'
  }
}

export class OctopodStdioBridgeUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OctopodStdioBridgeUnavailableError'
  }
}

export const OCTOPOD_TUNNEL_UNAVAILABLE_REASON = 'ssh_tunnel_unavailable'
export const OCTOPOD_WINDOWS_LAUNCH_REFUSED_CODE = 'octopod_windows_launch_refused'
export const OCTOPOD_WINDOWS_COMMAND_LINE_UNSAFE_CODE = 'octopod_windows_command_line_unsafe'

export type OctopodHostUnavailableReason =
  | 'unsupported_host'
  | 'artifacts_unavailable'
  | 'libc_unidentified'
  | 'runtime_self_test'
  | 'runtime_noexec'
  | 'windows_build_unsupported'
  | 'windows_no_extractor'
  | 'security_software'
  | 'native_preflight'
  | typeof OCTOPOD_TUNNEL_UNAVAILABLE_REASON

const UNAVAILABLE_BY_ERROR_NAME: Record<string, OctopodHostUnavailableReason> = {
  OctopodHostUnsupportedError: 'unsupported_host',
  OctopodArtifactsUnavailableError: 'artifacts_unavailable',
  OctopodRemoteLaunchUnsupportedError: 'unsupported_host',
  UnidentifiedHostLibcError: 'libc_unidentified',
  RemoteNodeRuntimeSelfTestError: 'runtime_self_test',
  RemoteNodeRuntimeNoexecError: 'runtime_noexec',
  RemoteWindowsBuildUnsupportedError: 'windows_build_unsupported',
  RemoteNodeRuntimeNoExtractorError: 'windows_no_extractor',
  RemoteNodeRuntimeSecurityModifiedError: 'security_software',
  OctopodStdioBridgeUnavailableError: OCTOPOD_TUNNEL_UNAVAILABLE_REASON,
  OctopodWindowsLaunchRefusedError: 'unsupported_host',
  OctopodWindowsCommandLineError: 'unsupported_host'
}

// Native preflight, PTY self-test and permanent Windows refusals repeat; transient races do not.
const UNAVAILABLE_BY_DEFERRAL_CODE: Record<string, OctopodHostUnavailableReason> = {
  octopod_candidate_preflight_failed: 'native_preflight',
  octopod_activation_pty_self_test_failed: 'native_preflight',
  [OCTOPOD_WINDOWS_LAUNCH_REFUSED_CODE]: 'unsupported_host',
  [OCTOPOD_WINDOWS_COMMAND_LINE_UNSAFE_CODE]: 'unsupported_host'
}

// Reprobed on every connect, so fixing or upgrading the host needs no new Shield version.
const FIXABLE_ON_HOST: ReadonlySet<string> = new Set<OctopodHostUnavailableReason>([
  'runtime_noexec',
  'windows_build_unsupported',
  'windows_no_extractor'
])

export function isOctopodHostUnavailableFixableOnHost(reason: string): boolean {
  return FIXABLE_ON_HOST.has(reason)
}

export function octopodCandidateLaunchFailureCode(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return code === OCTOPOD_WINDOWS_LAUNCH_REFUSED_CODE ||
    code === OCTOPOD_WINDOWS_COMMAND_LINE_UNSAFE_CODE
    ? code
    : 'octopod_candidate_launch_failed'
}

export function classifyOctopodHostUnavailable(failure: unknown): OctopodHostUnavailableReason | null {
  if (failure instanceof Error) {
    return UNAVAILABLE_BY_ERROR_NAME[failure.name] ?? null
  }
  if (failure && typeof failure === 'object' && 'code' in failure) {
    const code = failure.code
    return typeof code === 'string' ? (UNAVAILABLE_BY_DEFERRAL_CODE[code] ?? null) : null
  }
  return null
}
