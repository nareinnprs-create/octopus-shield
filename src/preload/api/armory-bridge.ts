import { ipcRenderer } from 'electron'
import type {
  ArmoryHealthReport,
  ArmoryRunIpcRequest,
  ArmoryRunOutcome,
  ArmoryScopeState,
  ArmorySetupState,
  ArmoryToolView
} from '../../shared/armory-contract'
import type { PreloadApi } from '../api-types'

export const armoryApi = {
  list: (): Promise<readonly ArmoryToolView[]> => ipcRenderer.invoke('armory:list'),
  scope: (): Promise<ArmoryScopeState> => ipcRenderer.invoke('armory:scope'),
  health: (): Promise<ArmoryHealthReport> => ipcRenderer.invoke('armory:health'),
  setup: (): Promise<ArmorySetupState> => ipcRenderer.invoke('armory:setup'),
  run: (request: ArmoryRunIpcRequest): Promise<ArmoryRunOutcome> =>
    ipcRenderer.invoke('armory:run', request)
} satisfies PreloadApi['armory']
