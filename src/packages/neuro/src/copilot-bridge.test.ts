import { describe, expect, it } from 'vitest'
import {
  GanglionRuntime,
  seedDefaultGanglionRegistry,
  type SubagentExecution
} from '@shield/ganglion'
import { BUILTIN_COPILOTS, createCopilotRegistry, registerCustomCopilot } from './copilots'
import { planCopilotSpawn, spawnCopilotTask, type CopilotSpawnInput } from './copilot-bridge'

const forge = BUILTIN_COPILOTS.find((copilot) => copilot.id === 'forge')
if (!forge) {
  throw new Error('Forge persona missing')
}

const input: CopilotSpawnInput = {
  taskId: 'task-1',
  title: 'Add logout',
  prompt: 'Implement the logout button'
}

describe('planCopilotSpawn', () => {
  it('maps a built-in persona onto its Ganglion Tentacle with a composed prompt', () => {
    const outcome = planCopilotSpawn(forge, input)
    if (!outcome.ok) {
      throw new Error(outcome.reason)
    }
    expect(outcome.plan.tentacle).toBe('Forge')
    expect(outcome.plan.task).toEqual({
      id: 'task-1',
      title: 'Add logout',
      prompt: `${forge.systemPrompt}\n\nImplement the logout button`
    })
  })

  it('rejects empty task fields', () => {
    expect(planCopilotSpawn(forge, { ...input, taskId: ' ' }).ok).toBe(false)
    expect(planCopilotSpawn(forge, { ...input, title: '' }).ok).toBe(false)
    expect(planCopilotSpawn(forge, { ...input, prompt: '' }).ok).toBe(false)
  })

  it('gates custom personas against the known Tentacle names', () => {
    const bad = registerCustomCopilot(createCopilotRegistry(), {
      id: 'ghost',
      persona: 'Ghost',
      systemPrompt: 'You are Ghost.',
      toolGrants: ['read-only'],
      tentacle: 'Not-A-Tentacle'
    })
    if (!bad.ok) {
      throw new Error(bad.reason)
    }
    expect(planCopilotSpawn(bad.copilot, input).ok).toBe(false)

    const good = registerCustomCopilot(createCopilotRegistry(), {
      id: 'scout',
      persona: 'Scout',
      systemPrompt: 'You are Scout.',
      toolGrants: ['read-only'],
      tentacle: 'Archivist',
      modelOverride: 'ollama/qwen3-coder'
    })
    if (!good.ok) {
      throw new Error(good.reason)
    }
    const outcome = planCopilotSpawn(good.copilot, input)
    if (!outcome.ok) {
      throw new Error(outcome.reason)
    }
    expect(outcome.plan.tentacle).toBe('Archivist')
    expect(outcome.plan.modelOverride).toBe('ollama/qwen3-coder')
  })
})

describe('copilot spawn over the Ganglion seam', () => {
  it('delegates through GanglionRuntime.spawn with a fake executor (no LLM)', async () => {
    const executions: SubagentExecution[] = []
    let delegated = 0
    const runtime = new GanglionRuntime({
      registry: seedDefaultGanglionRegistry(),
      executor: (tentacle, task) => {
        delegated += 1
        const execution: SubagentExecution = {
          sessionId: `fake:${task.id}`,
          status: 'completed',
          detail: 'fake completion'
        }
        executions.push(execution)
        return Promise.resolve(execution)
      }
    })
    const outcome = planCopilotSpawn(forge, input)
    if (!outcome.ok) {
      throw new Error(outcome.reason)
    }
    spawnCopilotTask(runtime, outcome.plan)
    expect(delegated).toBe(1)
    // registerSession lands in a microtask after the executor promise resolves.
    await new Promise((resolve) => setTimeout(resolve, 0))
    runtime.onComplete('fake:task-1', { status: 'completed', detail: 'fake completion' })
    const record = runtime.snapshot().tasks.find((task) => task.taskId === 'task-1')
    expect(record?.state).toBe('completed')
    expect(record?.tentacle).toBe('Forge')
    expect(executions[0]?.sessionId).toBe('fake:task-1')
  })
})
