// Brain Atlas IPC: serves semantic/symbol/graph/status queries into @shield/neuro.
// The backend resolves structurally at runtime; until Atlas-1's package lands the
// surface answers empty with an explicit `unavailable` status instead of failing.

import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import {
  AtlasGraphScopeSchema,
  AtlasSemanticQuerySchema,
  AtlasSymbolLookupSchema
} from '../../shared/neuro-atlas-contract'
import type {
  AtlasGraphSnapshot,
  AtlasGraphScope,
  AtlasSemanticMatch,
  AtlasSemanticQuery,
  AtlasStatus
} from '../../shared/neuro-atlas-contract'
import { isTrustedUIRenderer } from '../ipc/ui'

/** Structural subset of @shield/neuro's query surface this handler needs. */
export type NeuroAtlasQueryBackend = {
  semantic: (query: AtlasSemanticQuery) => Promise<readonly AtlasSemanticMatch[]>
  symbol: (name: string, limit?: number) => Promise<readonly AtlasSemanticMatch[]>
  graph: (scope: AtlasGraphScope) => Promise<AtlasGraphSnapshot>
  status: () => Promise<AtlasStatus>
}

export const emptyAtlasGraph = (): AtlasGraphSnapshot => ({
  nodes: [],
  edges: [],
  generatedAtEpochMs: Date.now()
})

const unavailableStatus = (detail: string): AtlasStatus => ({
  available: false,
  state: 'unavailable',
  detail
})

export class UnavailableAtlasBackend implements NeuroAtlasQueryBackend {
  constructor(private readonly detail: string) {}

  async semantic(): Promise<readonly AtlasSemanticMatch[]> {
    return []
  }

  async symbol(): Promise<readonly AtlasSemanticMatch[]> {
    return []
  }

  async graph(): Promise<AtlasGraphSnapshot> {
    return emptyAtlasGraph()
  }

  async status(): Promise<AtlasStatus> {
    return unavailableStatus(this.detail)
  }
}

/** Picks the query surface out of whatever `@shield/neuro` exports, or null. */
function coerceBackend(mod: unknown): NeuroAtlasQueryBackend | null {
  const candidates = [mod, (mod as { default?: unknown } | null)?.default]
  for (const candidate of candidates) {
    const asRecord = candidate as
      | { query?: Partial<NeuroAtlasQueryBackend>; semantic?: unknown }
      | null
    const query = asRecord?.query
    if (
      query &&
      typeof query.semantic === 'function' &&
      typeof query.symbol === 'function' &&
      typeof query.graph === 'function' &&
      typeof query.status === 'function'
    ) {
      return query as NeuroAtlasQueryBackend
    }
  }
  return null
}

/**
 * SAFETY: resolves the specifier through a runtime variable so the build does not
 * statically require `@shield/neuro` (Atlas-1 may land it after this file).
 */
export function createAtlasBackendResolver(
  moduleSpecifier = '@shield/neuro'
): () => Promise<NeuroAtlasQueryBackend> {
  let cached: Promise<NeuroAtlasQueryBackend> | null = null
  return () => {
    cached ??= (async () => {
      try {
        const imported: unknown = await import(/* @vite-ignore */ moduleSpecifier)
        return coerceBackend(imported) ?? new UnavailableAtlasBackend('query module shape unknown')
      } catch {
        return new UnavailableAtlasBackend('@shield/neuro indexer is not available')
      }
    })()
    return cached
  }
}

export class AtlasQueryService {
  private readonly resolve: () => Promise<NeuroAtlasQueryBackend>

  constructor(resolve?: () => Promise<NeuroAtlasQueryBackend>) {
    this.resolve = resolve ?? createAtlasBackendResolver()
  }

  async semantic(rawQuery: unknown): Promise<readonly AtlasSemanticMatch[]> {
    const parsed = AtlasSemanticQuerySchema.safeParse(rawQuery)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? 'Invalid semantic query')
    }
    return this.resolve().then((backend) => backend.semantic(parsed.data))
  }

  async symbol(rawLookup: unknown): Promise<readonly AtlasSemanticMatch[]> {
    const parsed = AtlasSymbolLookupSchema.safeParse(rawLookup)
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? 'Invalid symbol lookup')
    }
    return this.resolve().then((backend) =>
      backend.symbol(parsed.data.name, parsed.data.limit ?? 20)
    )
  }

  async graph(rawScope: unknown): Promise<AtlasGraphSnapshot> {
    const parsed = AtlasGraphScopeSchema.safeParse(rawScope ?? {})
    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? 'Invalid graph scope')
    }
    return this.resolve().then((backend) => backend.graph(parsed.data))
  }

  async status(): Promise<AtlasStatus> {
    return this.resolve().then((backend) => backend.status())
  }
}

export function registerNeuroAtlasHandlers(deps?: {
  resolveBackend?: () => Promise<NeuroAtlasQueryBackend>
  service?: AtlasQueryService
}): void {
  const service = deps?.service ?? new AtlasQueryService(deps?.resolveBackend)
  const handleTrusted = <A extends unknown[]>(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: A) => unknown
  ): void => {
    ipcMain.handle(channel, (event, ...args: A) => {
      if (!isTrustedUIRenderer(event.sender)) {
        throw new Error('Unauthorized neuro IPC sender')
      }
      return listener(event, ...args)
    })
  }
  handleTrusted('neuro:atlas:semantic', (_event, query: unknown) => service.semantic(query))
  handleTrusted('neuro:atlas:symbol', (_event, lookup: unknown) => service.symbol(lookup))
  handleTrusted('neuro:atlas:graph', (_event, scope: unknown) => service.graph(scope))
  handleTrusted('neuro:atlas:status', () => service.status())
}
