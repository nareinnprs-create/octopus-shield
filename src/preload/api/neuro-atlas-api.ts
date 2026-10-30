import type {
  AtlasGraphScope,
  AtlasGraphSnapshot,
  AtlasSemanticMatch,
  AtlasSemanticQuery,
  AtlasStatus
} from '../../shared/neuro-atlas-contract'

export type NeuroAtlasApi = {
  semantic: (query: AtlasSemanticQuery) => Promise<readonly AtlasSemanticMatch[]>
  symbol: (lookup: { name: string; limit?: number }) => Promise<readonly AtlasSemanticMatch[]>
  graph: (scope?: AtlasGraphScope) => Promise<AtlasGraphSnapshot>
  status: () => Promise<AtlasStatus>
}
