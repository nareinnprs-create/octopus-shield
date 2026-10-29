/** Explicit lock recovery for cases automatic startup cannot judge, such as shared-home reboot (#32177).
 * Dependency-free so clients, CLI and launcher share the command/result. */
import { quotePosixShellUnlessPlain } from './shell-argument-quoting'

export const OCTOPOD_RECLAIM_STALE_LOCK_FLAG = '--reclaim-stale-lock'
export const OCTOPOD_STALE_LOCK_DATA_ROOT_FLAG = '--data-root'
/** Pin confirmation to dry-run evidence. Clients probe this flag in bundles; reclaim alone cannot confirm safely. */
export const OCTOPOD_STALE_LOCK_EXPECT_NONCE_FLAG = '--expect-nonce'

/** `--json` prints one of these; the exit code names the status too. */
export type OctopodStaleLockReclaimStatus = 'none' | 'eligible' | 'refused' | 'reclaimed'

export type OctopodStaleLockEvidence = {
  pid: number
  host: string
  bootId: string
  currentBootId: string
  ageMinutes: number
  /** The record's own nonce, for `--expect-nonce`; absent from builds before the pin. */
  nonce?: string
}

// Why `none` is not 0: a command pointed at the wrong data root must never read as a recovery.
export const OCTOPOD_STALE_LOCK_RECLAIM_EXIT_CODES: Record<OctopodStaleLockReclaimStatus, number> = {
  reclaimed: 0,
  refused: 1,
  eligible: 2,
  none: 4
}

/** Managed hosts lack shield/octopod on PATH, so pasteable hints must name the holder’s runtime, entry and data root. */
export type OctopodReclaimHintRuntime = { execPath: string; entry: string | undefined }

export function octopodStaleLockReclaimCommand(
  dataRoot: string,
  runtime: OctopodReclaimHintRuntime | null
): string {
  const program = runtime?.entry
    ? `${quotePosixShellUnlessPlain(runtime.execPath)} ${quotePosixShellUnlessPlain(runtime.entry)}`
    : 'shield serve'
  return `${program} ${OCTOPOD_RECLAIM_STALE_LOCK_FLAG} ${OCTOPOD_STALE_LOCK_DATA_ROOT_FLAG} ${quotePosixShellUnlessPlain(dataRoot)}`
}
