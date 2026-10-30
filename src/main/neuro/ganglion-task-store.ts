// Restart-resume ledger for delegated Tentacle tasks; JSON in userData, rewritten on change.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { NeuroSessionState, NeuroSessionView } from '../../shared/neuro-sessions-contract'

export type NeuroTaskRecord = NeuroSessionView & {
  /** Original task prompt; retry re-spawns it verbatim. */
  prompt: string
}

const NON_TERMINAL_STATES: readonly NeuroSessionState[] = ['queued', 'running']

export class GanglionTaskStore {
  private records: NeuroTaskRecord[] = []
  private persisting: Promise<void> = Promise.resolve()

  constructor(
    private readonly file: string,
    private readonly now = Date.now
  ) {}

  /** Loads the ledger and marks tasks that were mid-flight at shutdown as interrupted. */
  async load(): Promise<readonly NeuroTaskRecord[]> {
    let parsed: unknown = null
    try {
      parsed = JSON.parse(await readFile(this.file, 'utf8'))
    } catch {
      parsed = null
    }
    const tasks = (parsed as { tasks?: unknown } | null)?.tasks
    this.records = Array.isArray(tasks) ? (tasks as NeuroTaskRecord[]) : []
    let changed = false
    const at = this.now()
    for (const record of this.records) {
      if (NON_TERMINAL_STATES.includes(record.state)) {
        record.state = 'interrupted'
        record.updatedAtEpochMs = at
        changed = true
      }
    }
    if (changed) {
      await this.persist()
    }
    return this.records
  }

  append(record: NeuroTaskRecord): Promise<void> {
    this.records = [record, ...this.records]
    return this.persist()
  }

  patch(taskId: string, patch: Partial<Omit<NeuroTaskRecord, 'taskId'>>): Promise<void> {
    const record = this.records.find((candidate) => candidate.taskId === taskId)
    if (!record) {
      return Promise.resolve()
    }
    Object.assign(record, patch, { updatedAtEpochMs: this.now() })
    return this.persist()
  }

  find(taskId: string): NeuroTaskRecord | undefined {
    return this.records.find((candidate) => candidate.taskId === taskId)
  }

  all(): readonly NeuroTaskRecord[] {
    return this.records
  }

  /** Serialized write-behind: concurrent callers share one tmp-file swap, last state wins. */
  private persist(): Promise<void> {
    const next = this.persisting.then(() => this.writeOnce())
    this.persisting = next.catch(() => undefined)
    return next
  }

  private async writeOnce(): Promise<void> {
    try {
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      await writeFile(tmp, JSON.stringify({ tasks: this.records }), 'utf8')
      // Windows: the destination can be briefly held open by a concurrent reader; retry the swap.
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(tmp, this.file)
          break
        } catch (error) {
          if (attempt >= 3 || (error as NodeJS.ErrnoException).code !== 'EPERM') {
            throw error
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
      }
    } catch (error) {
      console.warn('[neuro] ganglion task ledger write failed', error)
    }
  }
}
