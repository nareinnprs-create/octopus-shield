// Maps a Copilot persona onto the Ganglion subagent seam: the (tentacle, task)
// pair GanglionRuntime.spawn consumes. Structural only — the real executor
// adapter lives in src/main/neuro/ganglion-executor-adapter.ts (read-only here).

import { isKnownTentacleName, type SubagentTask, type TentacleName } from '@shield/ganglion'
import { copilotSpawnRequest, type CopilotDefinition } from './copilots'

export type CopilotSpawnInput = {
  taskId: string
  title: string
  prompt: string
}

export type CopilotSpawnPlan = {
  copilotId: string
  tentacle: TentacleName
  task: SubagentTask
  modelOverride?: string
}

export type CopilotSpawnPlanOutcome =
  | { ok: true; plan: CopilotSpawnPlan }
  | { ok: false; reason: string }

/**
 * Persona -> Ganglion spawn options. The persona system prompt rides inside the
 * task prompt (the executor delivers it as a single prompt turn); tentacle names
 * are gated against the Ganglion registry so an unknown custom target fails here.
 */
export function planCopilotSpawn(
  copilot: CopilotDefinition,
  input: CopilotSpawnInput
): CopilotSpawnPlanOutcome {
  if (input.taskId.trim().length === 0) {
    return { ok: false, reason: 'Task id is empty' }
  }
  if (input.title.trim().length === 0) {
    return { ok: false, reason: 'Task title is empty' }
  }
  if (input.prompt.trim().length === 0) {
    return { ok: false, reason: 'Task prompt is empty' }
  }
  const request = copilotSpawnRequest(copilot, { title: input.title, prompt: input.prompt })
  if (!isKnownTentacleName(request.tentacle)) {
    return { ok: false, reason: `Unknown Tentacle: ${request.tentacle}` }
  }
  return {
    ok: true,
    plan: {
      copilotId: copilot.id,
      // SAFETY: isKnownTentacleName just gated this against TENTACLE_NAMES.
      tentacle: request.tentacle as TentacleName,
      task: {
        id: input.taskId,
        title: input.title,
        prompt: request.prompt
      },
      ...(request.modelOverride === undefined ? {} : { modelOverride: request.modelOverride })
    }
  }
}

/** Spawn contract the host GanglionRuntime satisfies; structural so tests fake it. */
export type CopilotSpawner = {
  spawn(
    tentacle: TentacleName,
    task: SubagentTask
  ): { record: { taskId: string; tentacle: TentacleName } }
}

/** Delegates one planned copilot run through the Ganglion runtime. */
export function spawnCopilotTask(spawner: CopilotSpawner, plan: CopilotSpawnPlan): void {
  spawner.spawn(plan.tentacle, plan.task)
}
