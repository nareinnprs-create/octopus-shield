export type OctopodRuntimeCleanup = (state: { failed: boolean }) => void | Promise<void>

/** Failed teardown retains profile ownership: surviving writers cannot share a root with a new host. */
export class OctopodRuntimeLifetime {
  private readonly cleanups: OctopodRuntimeCleanup[] = []
  private stopping?: Promise<void>

  constructor(private readonly release: () => void = () => {}) {}

  add(cleanup: OctopodRuntimeCleanup): void {
    if (this.stopping) {
      throw new Error('octopod_runtime_lifetime_stopping')
    }
    this.cleanups.push(cleanup)
  }

  stop(): Promise<void> {
    this.stopping ??= Promise.resolve().then(async () => {
      const errors: unknown[] = []
      for (const cleanup of this.cleanups.splice(0).toReversed()) {
        try {
          await cleanup({ failed: errors.length > 0 })
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length === 1) {
        throw errors[0]
      }
      if (errors.length > 1) {
        throw new AggregateError(errors, 'octopod_runtime_cleanup_failed')
      }
      this.release()
    })
    return this.stopping
  }
}
