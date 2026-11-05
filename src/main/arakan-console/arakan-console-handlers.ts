// Arakan Console IPC (B6): trusted-renderer-gated channels over the singleton acp service.
import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isTrustedUIRenderer } from '../ipc/ui'
import { ArakanConsoleService } from './arakan-console-service'

const service = new ArakanConsoleService()

export function registerArakanConsoleHandlers(): void {
  const handleTrusted = (
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void => {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedUIRenderer(event.sender)) {
        throw new Error('Unauthorized arakan-console IPC sender')
      }
      return listener(event, ...args)
    })
  }

  handleTrusted('arakan-console:open', (event, rawRequest: unknown) => {
    const request = rawRequest as { cwd?: unknown }
    const cwd = typeof request?.cwd === 'string' && request.cwd.length > 0 ? request.cwd : null
    if (cwd === null) {
      return { ok: false as const, reason: 'cwd is required' }
    }
    const sink = (consoleEvent: unknown): void => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('arakan-console:event', consoleEvent)
      }
    }
    return service
      .open(cwd, sink)
      .then((result) => ({ ok: true as const, ...result }))
      .catch((error: unknown) => ({
        ok: false as const,
        reason: error instanceof Error ? error.message : String(error)
      }))
  })

  handleTrusted('arakan-console:prompt', (_event, rawRequest: unknown) => {
    const request = rawRequest as { text?: unknown }
    const text = typeof request?.text === 'string' ? request.text : ''
    if (text.trim().length === 0) {
      return Promise.resolve({ ok: false as const, reason: 'prompt text is required' })
    }
    return service
      .prompt(text)
      .then(() => ({ ok: true as const }))
      .catch((error: unknown) => ({
        ok: false as const,
        reason: error instanceof Error ? error.message : String(error)
      }))
  })

  handleTrusted('arakan-console:respond-permission', (_event, rawRequest: unknown) => {
    const request = rawRequest as { requestId?: unknown; optionId?: unknown }
    const ok = service.respondPermission({
      requestId: request?.requestId as string | number,
      optionId: String(request?.optionId ?? '')
    })
    return Promise.resolve({ ok })
  })

  handleTrusted('arakan-console:close', () => {
    service.close('closed by renderer')
    return Promise.resolve({ ok: true })
  })
}
