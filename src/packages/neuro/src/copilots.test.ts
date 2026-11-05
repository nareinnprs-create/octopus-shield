import { describe, expect, it } from 'vitest'
import {
  BUILTIN_COPILOTS,
  COPILOT_TOOL_GRANTS,
  MAX_COPILOT_PROMPT_CHARS,
  copilotSpawnRequest,
  createCopilotRegistry,
  listCopilots,
  registerCustomCopilot
} from './copilots'

describe('built-in copilots', () => {
  it('ships the seven Tentacle personas with grants and prompts', () => {
    expect(BUILTIN_COPILOTS.map((copilot) => copilot.id)).toEqual([
      'archivist',
      'forge',
      'sentinel',
      'prism',
      'inkwell',
      'scaffold',
      'verifier'
    ])
    for (const copilot of BUILTIN_COPILOTS) {
      expect(
        copilot.systemPrompt.split(/[.!?]/).filter((s) => s.trim()).length
      ).toBeGreaterThanOrEqual(2)
      expect(copilot.toolGrants.length).toBeGreaterThan(0)
      expect(
        copilot.toolGrants.every((grant) =>
          (COPILOT_TOOL_GRANTS as readonly string[]).includes(grant)
        )
      ).toBe(true)
      expect(copilot.tentacle).toBeTruthy()
      expect(copilot.custom).toBeUndefined()
    }
  })

  it('grants read-only scopes to the reviewer personas', () => {
    const grantsOf = (id: string): readonly string[] =>
      BUILTIN_COPILOTS.find((copilot) => copilot.id === id)?.toolGrants ?? []
    expect(grantsOf('archivist')).toContain('read-only')
    expect(grantsOf('sentinel')).toContain('armory')
    expect(grantsOf('prism')).toContain('screenshot')
    expect(grantsOf('forge')).toContain('file-edit')
    expect(grantsOf('verifier')).not.toContain('file-edit')
  })
})

describe('copilotSpawnRequest', () => {
  it('composes the persona system prompt ahead of the task prompt', () => {
    const forge = BUILTIN_COPILOTS.find((copilot) => copilot.id === 'forge')
    if (!forge) {
      throw new Error('Forge persona missing')
    }
    const request = copilotSpawnRequest(forge, {
      title: 'Add auth',
      prompt: 'Implement the login route'
    })
    expect(request.tentacle).toBe('Forge')
    expect(request.prompt.startsWith(forge.systemPrompt)).toBe(true)
    expect(request.prompt.endsWith('Implement the login route')).toBe(true)
  })
})

describe('registerCustomCopilot', () => {
  const valid = {
    id: 'scout',
    persona: 'Scout',
    systemPrompt: 'You are Scout. Map the repo surface.',
    toolGrants: ['read-only'],
    tentacle: 'Archivist'
  }

  it('registers a validated custom persona without capping the count', () => {
    let registry = createCopilotRegistry()
    for (let index = 0; index < 12; index += 1) {
      const outcome = registerCustomCopilot(registry, { ...valid, id: `scout-${index}` })
      expect(outcome.ok).toBe(true)
      if (outcome.ok) {
        registry = outcome.registry
      }
    }
    expect(listCopilots(registry)).toHaveLength(BUILTIN_COPILOTS.length + 12)
  })

  it('rejects non-slug ids, duplicates, empty prompts, and oversized prompts', () => {
    const registry = createCopilotRegistry()
    expect(registerCustomCopilot(registry, { ...valid, id: 'Bad Id' }).ok).toBe(false)
    expect(registerCustomCopilot(registry, { ...valid, id: 'archivist' }).ok).toBe(false)
    expect(registerCustomCopilot(registry, { ...valid, systemPrompt: '   ' }).ok).toBe(false)
    expect(
      registerCustomCopilot(registry, {
        ...valid,
        systemPrompt: 'x'.repeat(MAX_COPILOT_PROMPT_CHARS + 1)
      }).ok
    ).toBe(false)
  })

  it('rejects unknown grants and non-object input', () => {
    const registry = createCopilotRegistry()
    expect(registerCustomCopilot(registry, { ...valid, toolGrants: ['root-everything'] }).ok).toBe(
      false
    )
    expect(registerCustomCopilot(registry, { ...valid, toolGrants: [] }).ok).toBe(false)
    expect(registerCustomCopilot(registry, null).ok).toBe(false)
  })

  it('keeps the custom flag and spawn target on registered personas', () => {
    const outcome = registerCustomCopilot(createCopilotRegistry(), valid)
    if (!outcome.ok) {
      throw new Error(outcome.reason)
    }
    expect(outcome.copilot.custom).toBe(true)
    expect(outcome.copilot.tentacle).toBe('Archivist')
  })
})
