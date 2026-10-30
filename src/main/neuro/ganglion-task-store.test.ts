import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GanglionTaskStore } from './ganglion-task-store'

let directory: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'ganglion-store-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
})

const record = (taskId: string, state: 'running' | 'completed' = 'running') => ({
  taskId,
  tentacle: 'Forge',
  title: `Task ${taskId}`,
  prompt: 'do the thing',
  state,
  createdAtEpochMs: 1,
  updatedAtEpochMs: 1
})

describe('GanglionTaskStore', () => {
  it('round-trips records through the JSON ledger', async () => {
    const file = join(directory, 'neuro', 'ganglion-tasks.json')
    const store = new GanglionTaskStore(file, () => 5)
    await store.load()
    await store.append(record('task-1'))
    await store.patch('task-1', { state: 'completed', detail: 'done' })

    const reloaded = new GanglionTaskStore(file, () => 6)
    const tasks = await reloaded.load()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ taskId: 'task-1', state: 'completed', detail: 'done' })
    const raw = JSON.parse(await readFile(file, 'utf8')) as { tasks: unknown[] }
    expect(raw.tasks).toHaveLength(1)
  })

  it('marks mid-flight tasks interrupted on boot so the UI can offer retry', async () => {
    const file = join(directory, 'ganglion-tasks.json')
    await mkdir(directory, { recursive: true })
    await writeFile(
      file,
      JSON.stringify({ tasks: [record('live-1', 'running'), record('done-1', 'completed')] })
    )
    const store = new GanglionTaskStore(file, () => 9)
    const tasks = await store.load()
    expect(tasks.find((task) => task.taskId === 'live-1')?.state).toBe('interrupted')
    expect(tasks.find((task) => task.taskId === 'done-1')?.state).toBe('completed')
    // The interrupted transition is persisted.
    const reloaded = await new GanglionTaskStore(file, () => 10).load()
    expect(reloaded.find((task) => task.taskId === 'live-1')?.state).toBe('interrupted')
  })

  it('starts empty on a missing or corrupt ledger instead of throwing', async () => {
    const missing = new GanglionTaskStore(join(directory, 'absent', 'tasks.json'))
    expect(await missing.load()).toEqual([])
    const corruptFile = join(directory, 'corrupt.json')
    await writeFile(corruptFile, '{not json')
    expect(await new GanglionTaskStore(corruptFile).load()).toEqual([])
  })
})
