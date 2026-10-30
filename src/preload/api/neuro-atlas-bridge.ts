import { ipcRenderer } from 'electron'
import type {
  AtlasGraphScope,
  AtlasGraphSnapshot,
  AtlasSemanticMatch,
  AtlasSemanticQuery,
  AtlasStatus
} from '../../shared/neuro-atlas-contract'
import type { PreloadApi } from '../api-types'

export const neuroAtlasApi = {
  semantic: (query: AtlasSemanticQuery): Promise<readonly AtlasSemanticMatch[]> =>
    ipcRenderer.invoke('neuro:atlas:semantic', query),
  symbol: (lookup: { name: string; limit?: number }): Promise<readonly AtlasSemanticMatch[]> =>
    ipcRenderer.invoke('neuro:atlas:symbol', lookup),
  graph: (scope?: AtlasGraphScope): Promise<AtlasGraphSnapshot> =>
    ipcRenderer.invoke('neuro:atlas:graph', scope ?? {}),
  status: (): Promise<AtlasStatus> => ipcRenderer.invoke('neuro:atlas:status')
} satisfies PreloadApi['neuroAtlas']
