import { z } from 'zod'

// Renderer-facing contract for the Brain Atlas (see @shield/neuro query module).

export const ATLAS_NODE_KINDS = ['file', 'symbol', 'agent', 'audit'] as const
export const ATLAS_EDGE_KINDS = ['imports', 'calls', 'semantic', 'audit'] as const

export type AtlasNodeKind = (typeof ATLAS_NODE_KINDS)[number]
export type AtlasEdgeKind = (typeof ATLAS_EDGE_KINDS)[number]

export type AtlasNode = {
  id: string
  kind: AtlasNodeKind
  label: string
  path?: string
  lineStart?: number
  lineEnd?: number
}

export type AtlasEdge = {
  source: string
  target: string
  kind: AtlasEdgeKind
  /** Blended link strength, 0..1. */
  strength: number
}

export type AtlasGraphSnapshot = {
  nodes: readonly AtlasNode[]
  edges: readonly AtlasEdge[]
  generatedAtEpochMs: number
}

export type AtlasSemanticMatch = {
  id: string
  kind: AtlasNodeKind
  label: string
  path?: string
  /** Cosine/blend relevance, 0..1. */
  score: number
}

export type AtlasStatus = {
  available: boolean
  state: 'unavailable' | 'idle' | 'indexing' | 'error'
  detail?: string
  fileCount?: number
  chunkCount?: number
  lastIndexedAtEpochMs?: number
}

const nonEmpty = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim().length > 0, 'Query is empty')

export const AtlasSemanticQuerySchema = z.object({
  text: nonEmpty(512),
  kind: z.enum(ATLAS_NODE_KINDS).optional(),
  pathPrefix: z.string().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(50).optional()
})
export type AtlasSemanticQuery = z.infer<typeof AtlasSemanticQuerySchema>

export const AtlasSymbolLookupSchema = z.object({
  name: nonEmpty(256),
  limit: z.number().int().min(1).max(50).optional()
})
export type AtlasSymbolLookup = z.infer<typeof AtlasSymbolLookupSchema>

export const AtlasGraphScopeSchema = z.object({
  repoPath: z.string().min(1).max(32_768).optional(),
  kinds: z.array(z.enum(ATLAS_NODE_KINDS)).max(ATLAS_NODE_KINDS.length).optional(),
  limit: z.number().int().min(1).max(500).optional()
})
export type AtlasGraphScope = z.infer<typeof AtlasGraphScopeSchema>
