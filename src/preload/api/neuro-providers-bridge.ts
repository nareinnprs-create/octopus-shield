import { ipcRenderer } from 'electron'
import type { NeuroProviderProfile } from '../../shared/neuro-provider-types'
import type { PreloadApi } from '../api-types'

export const neuroProvidersApi = {
  getStatus: () => ipcRenderer.invoke('neuroProviders:list'),
  save: (profile: NeuroProviderProfile) => ipcRenderer.invoke('neuroProviders:save', profile),
  remove: (id: string) => ipcRenderer.invoke('neuroProviders:remove', id),
  saveApiKey: (id: string, key: string) => ipcRenderer.invoke('neuroProviders:saveApiKey', id, key),
  clearApiKey: (id: string) => ipcRenderer.invoke('neuroProviders:clearApiKey', id),
  test: (input: { profile: NeuroProviderProfile; key?: string }) =>
    ipcRenderer.invoke('neuroProviders:test', input)
} satisfies PreloadApi['neuroProviders']
