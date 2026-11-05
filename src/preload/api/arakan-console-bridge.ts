import { ipcRenderer } from 'electron'
import type {
  ArakanConsoleEvent,
  ArakanConsoleOpenRequest,
  ArakanConsolePermissionResponse,
  ArakanConsolePromptRequest
} from '../../shared/arakan-console-contract'
import type { PreloadApi } from '../api-types'

export const arakanConsoleApi = {
  open: (request: ArakanConsoleOpenRequest) => ipcRenderer.invoke('arakan-console:open', request),
  prompt: (request: ArakanConsolePromptRequest) =>
    ipcRenderer.invoke('arakan-console:prompt', request),
  respondPermission: (response: ArakanConsolePermissionResponse) =>
    ipcRenderer.invoke('arakan-console:respond-permission', response),
  close: () => ipcRenderer.invoke('arakan-console:close'),
  onEvent: (listener: (event: ArakanConsoleEvent) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: ArakanConsoleEvent): void => listener(payload)
    ipcRenderer.on('arakan-console:event', wrapped)
    return () => {
      ipcRenderer.removeListener('arakan-console:event', wrapped)
    }
  }
} satisfies PreloadApi['arakanConsole']
