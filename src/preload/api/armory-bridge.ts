import { ipcRenderer } from 'electron'
import type {
  ArmoryHealthReport,
  ArmoryRunIpcRequest,
  ArmoryRunOutcome,
  ArmoryScopeState,
  ArmoryToolView
} from '../../shared/armory-contract'
import type { PreloadApi } from '../api-types'

export const armoryApi = {
  list: (): Promise<readonly ArmoryToolView[]> => ipcRenderer.invoke('armory:list'),
  scope: (): Promise<ArmoryScopeState> => ipcRenderer.invoke('armory:scope'),
  health: (): Promise<ArmoryHealthReport> => ipcRenderer.invoke('armory:health'),
  run: (request: ArmoryRunIpcRequest): Promise<ArmoryRunOutcome> =>
    ipcRenderer.invoke('armory:run', request)
} satisfies PreloadApi['armory']
