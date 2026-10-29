/** Armory tool descriptor: one integrated security tool, never executed without scope authorization. */

export type ArmoryRuntime = 'win' | 'wsl' | 'docker'

export type ArmoryCategory =
  | 'recon'
  | 'exploitation'
  | 'post-exploitation'
  | 'web'
  | 'cracking'
  | 'wireless'
  | 'mitm'
  | 'forensics'

/**
 * Scope class drives authorization strictness. Every class requires an
 * authorized target; exploitation/post-exploitation additionally require the
 * OSHIELD_ARMORY_EXPLOIT_AUTHORIZED acknowledgment (explicit operator opt-in,
 * never defaulted).
 */
export type ArmoryScopeClass =
  | 'recon'
  | 'exploitation'
  | 'post-exploitation'
  | 'web'
  | 'cracking'
  | 'wireless'
  | 'mitm'
  | 'forensics'

export type ArmoryToolDescriptor = {
  id: string
  title: string
  category: ArmoryCategory
  runtime: ArmoryRuntime
  /** Absolute host path (win), WSL path (wsl), or image name (docker). */
  target: string
  /** Exact invocation producing a version/help string; used by inventory smoke. */
  versionArgv: readonly string[]
  scopeClass: ArmoryScopeClass
  status: 'ok' | 'failed' | 'quarantined-by-av' | 'skipped'
  /**
   * Docker-only: full host argv replacing the default `docker run --rm IMAGE args`
   * pattern (needed for images with entrypoint quirks, e.g. bundle-exec Metasploit).
   * Run-request args are appended verbatim.
   */
  dockerFullArgv?: readonly string[]
}
