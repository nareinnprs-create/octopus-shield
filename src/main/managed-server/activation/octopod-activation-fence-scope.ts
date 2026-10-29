// Resumed stale holders must prove their generation on-host before every step, preventing writes or release under a successor's fence.
import { AsyncLocalStorage } from 'node:async_hooks'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { isSshCommandExitError } from '../../ssh/remote-exec/remote-exec-command'

export const OCTOPOD_FENCE_OWNER_FILENAME = '.shield-fence-owner'
export const OCTOPOD_FENCE_LOST_MARKER = '__OCTOPOD_FENCE_LOST__'
/** EX_TEMPFAIL: this superseded generation cannot retry its step. */
export const OCTOPOD_FENCE_LOST_EXIT = 75

export type OctopodFence = { lockDir: string; token: string }

const scope = new AsyncLocalStorage<OctopodFence>()

export function runWithOctopodFence<T>(fence: OctopodFence, run: () => Promise<T>): Promise<T> {
  return scope.run(fence, run)
}

export function currentOctopodFence(): OctopodFence | null {
  return scope.getStore() ?? null
}

export class OctopodFenceLostError extends Error {
  constructor() {
    super(
      "This run's activation fence was taken over by another run, so it stopped before changing the host."
    )
    this.name = 'OctopodFenceLostError'
  }
}

export function posixOctopodFenceOwnedTest(fence: OctopodFence): string {
  const owner = quotePosixShell(
    `${fence.lockDir.replace(/\/+$/u, '')}/${OCTOPOD_FENCE_OWNER_FILENAME}`
  )
  return `[ "$(cat ${owner} 2>/dev/null)" = ${quotePosixShell(fence.token)} ]`
}

export function posixOctopodFenceGuard(fence: OctopodFence): string {
  return `${posixOctopodFenceOwnedTest(fence)} || { echo ${OCTOPOD_FENCE_LOST_MARKER}; exit ${OCTOPOD_FENCE_LOST_EXIT}; };`
}

/** Use exit status and stdout; error messages quote commands containing the marker even when no guard failed. */
export function isOctopodFenceLost(error: unknown): boolean {
  if (!isSshCommandExitError(error)) {
    return false
  }
  // `powershell -Command` reports any nonzero native exit as 1.
  const exited = error.exitCode === OCTOPOD_FENCE_LOST_EXIT || error.exitCode === 1
  return exited && error.stdout.trim().split(/\r?\n/u).at(-1) === OCTOPOD_FENCE_LOST_MARKER
}
