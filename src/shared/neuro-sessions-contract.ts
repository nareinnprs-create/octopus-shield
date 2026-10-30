import { z } from 'zod'

/** Renderer-facing projection of one delegated Tentacle task (see @shield/ganglion runtime). */
export type NeuroSessionState = 'queued' | 'running' | 'completed' | 'failed' | 'interrupted'

export type NeuroSessionView = {
  taskId: string
  tentacle: string
  title: string
  state: NeuroSessionState
  /** Ganglion session id (`ganglion:<taskId>`) once a session attached. */
  sessionId?: string
  detail?: string
  /** Live PTY handle; absent for tasks that never attached a session. */
  terminalHandle?: string
  tabId?: string
  worktreeId?: string
  createdAtEpochMs: number
  updatedAtEpochMs: number
}

export type NeuroSessionsSnapshot = {
  tasks: readonly NeuroSessionView[]
  tentacles: readonly string[]
}

export const NeuroSessionSpawnRequestSchema = z.object({
  tentacle: z.string().min(1).max(64),
  title: z
    .string()
    .min(1)
    .max(200)
    .refine((value) => value === value.trim(), 'Title has surrounding whitespace'),
  prompt: z
    .string()
    .min(1)
    .max(256 * 1024)
    .refine((value) => value.trim().length > 0, 'Prompt is empty'),
  worktree: z.string().min(1).max(32_768)
})

export type NeuroSessionSpawnRequest = z.infer<typeof NeuroSessionSpawnRequestSchema>

export type NeuroSessionSpawnOutcome = { ok: true; taskId: string } | { ok: false; reason: string }
