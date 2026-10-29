/**
 * The Sucker process seam (docs/sucker-contract.md §3/§5): the real
 * Shed/Ganglion runner plugs in as this structural shape the same way
 * @shield/armory consumes @shield/process-host, while tests and the CLI
 * inject fakes. The broker never resolves programs or shells itself — args
 * pass through verbatim, only after the grant check.
 */

export type SuckerProcessRequest = {
  suckerId: string
  capability: string
  args: readonly string[]
  timeoutMs: number
}

export type SuckerProcessResult = {
  exitCode: number | null
  timedOut: boolean
  durationMs: number
  stdout: string
  stderr: string
}

/** Structural spawn interface; the real runner implements this shape. */
export type SuckerProcessLike = (request: SuckerProcessRequest) => Promise<SuckerProcessResult>

/** Wiring-safe default: proves the broker→adapter seam without launching anything. */
export const noopSuckerProcess: SuckerProcessLike = async () => ({
  exitCode: 0,
  timedOut: false,
  durationMs: 0,
  stdout: '',
  stderr: ''
})
