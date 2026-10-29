// Require all probes idle throughout the quiet period; failed/unknown probes count as busy.

export type OctopodIdleVerdict = 'idle' | 'busy' | 'unverifiable'

export type OctopodIdleProbe = {
  name: string
  read: () => OctopodIdleVerdict | Promise<OctopodIdleVerdict>
}

export type OctopodIdleExitEvidence = { quietSince: number; stoppedAt: number; timeoutMs: number }

type OctopodIdleExitMonitorOptions = {
  timeoutMs: number
  probes: readonly OctopodIdleProbe[]
  /** Include requests completed between checks when restarting the quiet period. */
  lastClientActivityAt: () => number
  onIdle: (evidence: OctopodIdleExitEvidence) => void | boolean | Promise<void | boolean>
  now?: () => number
  pollMs?: number
  log?: (line: string) => void
}

export function resolveOctopodIdlePollMs(timeoutMs: number): number {
  return Math.min(60_000, Math.max(250, Math.floor(timeoutMs / 5)))
}

export class OctopodIdleExitMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null
  private quietSince: number | null = null
  private blocker: string | null = null
  private stopped = false
  private readonly now: () => number
  private readonly pollMs: number
  private readonly log: (line: string) => void

  constructor(private readonly options: OctopodIdleExitMonitorOptions) {
    this.now = options.now ?? Date.now
    this.pollMs = options.pollMs ?? resolveOctopodIdlePollMs(options.timeoutMs)
    this.log = options.log ?? ((line) => console.error(line))
  }

  start(): void {
    this.schedule()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  async check(): Promise<boolean> {
    const blocker = await this.findBlocker()
    if (this.stopped) {
      return false
    }
    const now = this.now()
    if (blocker) {
      if (this.quietSince !== null || this.blocker !== blocker) {
        this.log(`[octopod] idle exit waiting: ${blocker}`)
      }
      this.quietSince = null
      this.blocker = blocker
      return false
    }
    if (this.quietSince === null) {
      this.quietSince = now
      this.blocker = null
      this.log(`[octopod] idle; stopping after ${this.options.timeoutMs}ms unless a client returns`)
    }
    const quietSince = Math.max(this.quietSince, this.options.lastClientActivityAt())
    if (now - quietSince < this.options.timeoutMs) {
      return false
    }
    if (
      (await this.options.onIdle({
        quietSince,
        stoppedAt: now,
        timeoutMs: this.options.timeoutMs
      })) === false
    ) {
      this.quietSince = null
      return false
    }
    this.stop()
    return true
  }

  private async findBlocker(): Promise<string | null> {
    for (const probe of this.options.probes) {
      let verdict: OctopodIdleVerdict
      try {
        verdict = await probe.read()
      } catch {
        verdict = 'unverifiable'
      }
      if (verdict !== 'idle') {
        return `${probe.name} ${verdict}`
      }
    }
    return null
  }

  private schedule(): void {
    if (this.stopped) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.check()
        .catch((error: unknown) => this.log(`[octopod] idle check failed: ${String(error)}`))
        .finally(() => this.schedule())
    }, this.pollMs)
    this.timer.unref?.()
  }
}
