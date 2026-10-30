import { ipcRenderer } from 'electron'
import type {
  NeuroSessionSpawnOutcome,
  NeuroSessionSpawnRequest,
  NeuroSessionsSnapshot
} from '../../shared/neuro-sessions-contract'
import type { PreloadApi } from '../api-types'

export const neuroSessionsApi = {
  list: (): Promise<NeuroSessionsSnapshot> => ipcRenderer.invoke('neuro:sessions:list'),
  spawn: (request: NeuroSessionSpawnRequest): Promise<NeuroSessionSpawnOutcome> =>
    ipcRenderer.invoke('neuro:sessions:spawn', request),
  stop: (taskId: string): Promise<boolean> => ipcRenderer.invoke('neuro:sessions:stop', taskId),
  retry: (taskId: string): Promise<NeuroSessionSpawnOutcome> =>
    ipcRenderer.invoke('neuro:sessions:retry', taskId)
} satisfies PreloadApi['neuroSessions']
