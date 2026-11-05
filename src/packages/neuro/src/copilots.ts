// Copilot persona registry: the 7 built-in Tentacle copilots plus validated
// user-defined personas. Pure data — Ganglion spawn wiring lives in ./copilot-bridge.

export const COPILOT_TOOL_GRANTS = [
  'read-only',
  'file-edit',
  'file-create',
  'terminal',
  'atlas',
  'armory',
  'screenshot'
] as const

export type CopilotToolGrant = (typeof COPILOT_TOOL_GRANTS)[number]

export type CopilotDefinition = {
  /** Stable slug; built-ins use their Tentacle name lowercased. */
  id: string
  /** Display label for the persona. */
  persona: string
  systemPrompt: string
  toolGrants: readonly CopilotToolGrant[]
  modelOverride?: string
  /** True for user-registered personas (vs the built-in seven). */
  custom?: boolean
  /** Ganglion spawn target; required for custom personas, fixed for built-ins. */
  tentacle?: string
}

export const BUILTIN_COPILOTS: readonly CopilotDefinition[] = [
  {
    id: 'archivist',
    persona: 'Archivist',
    systemPrompt:
      'You are Archivist, the codebase historian of the Octopus. Answer "why is this code here" by tracing history, audit records, and Atlas graph links, and cite file paths as evidence. You read — you never modify. When the record is silent, say so instead of guessing.',
    toolGrants: ['read-only', 'atlas'],
    tentacle: 'Archivist'
  },
  {
    id: 'forge',
    persona: 'Forge',
    systemPrompt:
      'You are Forge, the builder tentacle of the Octopus. Implement features with the smallest correct diff, following the patterns the repo already has. File edits and terminal use are scope-gated to the workspace you were delegated. Report what changed and how you verified it.',
    toolGrants: ['file-edit', 'terminal'],
    tentacle: 'Forge'
  },
  {
    id: 'sentinel',
    persona: 'Sentinel',
    systemPrompt:
      'You are Sentinel, the security reviewer of the Octopus. Run a threat pass over diffs: trust boundaries, injection, secrets, privilege, and data exposure, cross-referencing armory and audit events. You read only — deliver findings, not fixes. Every verdict names the exact lines at risk.',
    toolGrants: ['read-only', 'armory'],
    tentacle: 'Sentinal-7'
  },
  {
    id: 'prism',
    persona: 'Prism',
    systemPrompt:
      'You are Prism, the UI reviewer of the Octopus. Judge screens against the design system — tokens, spacing, hierarchy, dark mode, accessibility — and capture a screenshot before any verdict. You read only. Point at the exact element, not the general area.',
    toolGrants: ['read-only', 'screenshot'],
    tentacle: 'Prism'
  },
  {
    id: 'inkwell',
    persona: 'Inkwell',
    systemPrompt:
      "You are Inkwell, the docs tentacle of the Octopus. Turn diffs and decisions into README, ADR, and doc updates in the repo's existing voice. Your edits stay confined to docs paths. Prefer deleting stale words over adding new ones.",
    toolGrants: ['file-edit'],
    tentacle: 'Inkwell'
  },
  {
    id: 'scaffold',
    persona: 'Scaffold',
    systemPrompt:
      'You are Scaffold, the scaffolder of the Octopus. Grow new modules and features from the templates and conventions the repo already has — never invent structure it does not. You create files. Leave a short wiring note wherever the scaffold expects a human decision.',
    toolGrants: ['file-create'],
    tentacle: 'Scaffold'
  },
  {
    id: 'verifier',
    persona: 'Verifier',
    systemPrompt:
      'You are Verifier, the test tentacle of the Octopus. Write and run the tests that gate the work, and fail visible with the exact command and output. Terminal use is limited to build and test commands. A gate you did not run is not a gate.',
    toolGrants: ['terminal'],
    tentacle: 'Verifier'
  }
]

export type CustomCopilotInput = {
  id: string
  persona: string
  systemPrompt: string
  toolGrants: readonly CopilotToolGrant[]
  modelOverride?: string
  tentacle: string
}

export type CopilotRegistry = {
  builtins: readonly CopilotDefinition[]
  custom: readonly CopilotDefinition[]
}

export const createCopilotRegistry = (): CopilotRegistry => ({
  builtins: BUILTIN_COPILOTS,
  custom: []
})

export const listCopilots = (registry: CopilotRegistry): readonly CopilotDefinition[] => [
  ...registry.builtins,
  ...registry.custom
]

const COPILOT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const MAX_COPILOT_PROMPT_CHARS = 4000

export type RegisterCopilotOutcome =
  | { ok: true; copilot: CopilotDefinition; registry: CopilotRegistry }
  | { ok: false; reason: string }

const isCopilotToolGrant = (value: unknown): value is CopilotToolGrant =>
  (COPILOT_TOOL_GRANTS as readonly unknown[]).includes(value)

/** Validates and appends a user-defined persona; no cap on how many can be registered. */
export function registerCustomCopilot(
  registry: CopilotRegistry,
  input: unknown
): RegisterCopilotOutcome {
  if (typeof input !== 'object' || input === null) {
    return { ok: false, reason: 'Copilot definition must be an object' }
  }
  const draft = input as Record<string, unknown>
  const id = typeof draft.id === 'string' ? draft.id : ''
  if (!COPILOT_ID_PATTERN.test(id)) {
    return { ok: false, reason: 'Copilot id must be a lowercase slug (a-z, 0-9, dashes)' }
  }
  if (listCopilots(registry).some((copilot) => copilot.id === id)) {
    return { ok: false, reason: `Copilot id already registered: ${id}` }
  }
  const persona = typeof draft.persona === 'string' ? draft.persona.trim() : ''
  if (persona.length === 0 || persona.length > 64) {
    return { ok: false, reason: 'Persona label must be 1-64 characters' }
  }
  const systemPrompt = typeof draft.systemPrompt === 'string' ? draft.systemPrompt : ''
  if (systemPrompt.trim().length === 0) {
    return { ok: false, reason: 'System prompt is empty' }
  }
  if (systemPrompt.length > MAX_COPILOT_PROMPT_CHARS) {
    return { ok: false, reason: `System prompt exceeds ${MAX_COPILOT_PROMPT_CHARS} characters` }
  }
  const grants = Array.isArray(draft.toolGrants) ? draft.toolGrants : []
  if (grants.length === 0 || !grants.every(isCopilotToolGrant)) {
    return { ok: false, reason: 'Tool grants must be a non-empty subset of the known grants' }
  }
  const tentacle = typeof draft.tentacle === 'string' ? draft.tentacle.trim() : ''
  if (tentacle.length === 0 || tentacle.length > 64) {
    return { ok: false, reason: 'Custom copilots need a Tentacle spawn target' }
  }
  const modelOverride =
    typeof draft.modelOverride === 'string' && draft.modelOverride.trim().length > 0
      ? draft.modelOverride.trim()
      : undefined
  const copilot: CopilotDefinition = {
    id,
    persona,
    systemPrompt,
    toolGrants: grants as readonly CopilotToolGrant[],
    tentacle,
    ...(modelOverride === undefined ? {} : { modelOverride }),
    custom: true
  }
  return {
    ok: true,
    copilot,
    registry: { ...registry, custom: [...registry.custom, copilot] }
  }
}

export type CopilotSpawnRequest = {
  tentacle: string
  title: string
  /** Persona system prompt composed ahead of the user task prompt. */
  prompt: string
  modelOverride?: string
}

/** Composes the (tentacle, prompt) payload a copilot spawn sends through the sessions bridge. */
export function copilotSpawnRequest(
  copilot: CopilotDefinition,
  task: { title: string; prompt: string }
): CopilotSpawnRequest {
  const tentacle = copilot.tentacle ?? 'Forge'
  return {
    tentacle,
    title: task.title,
    prompt: `${copilot.systemPrompt}\n\n${task.prompt}`,
    ...(copilot.modelOverride === undefined ? {} : { modelOverride: copilot.modelOverride })
  }
}
