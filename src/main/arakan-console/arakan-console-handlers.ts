// Arakan Console IPC (B6): trusted-renderer-gated channels over the singleton acp service.
import { ipcMain, app, type IpcMainInvokeEvent } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { isTrustedUIRenderer } from '../ipc/ui'
import { ArakanConsoleService } from './arakan-console-service'

const service = new ArakanConsoleService()

/**
 * Provider environment is opt-in. A distro must not override the user's Arakan config;
 * explicit Neuro/vault environment is still passed through. Also seeds the config template
 * once so `arakan configure` has the expected directory.
 */
function consoleSpawnEnv(request: { env?: unknown }): Record<string, string> | undefined {
  const explicit =
    typeof request?.env === 'object' && request.env !== null
      ? (request.env as Record<string, string>)
      : undefined
  const defaults: Record<string, string> = {}
  const initPath = app.isPackaged
    ? join(process.resourcesPath, 'arakan', 'init-config.yaml')
    : join(app.getAppPath(), 'resources', 'arakan', 'init-config.yaml')
  try {
    const text = readFileSync(initPath, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const match = /^(ARAKAN_[A-Z_]+):\s*(.+)$/.exec(line)
      if (match) {
        defaults[match[1]] = match[2].trim()
      }
    }
  } catch {
    // No shipped defaults; caller env decides.
  }
  try {
    const configDir = join(homedir(), '.arakan')
    const configFile = join(configDir, 'config.yaml')
    if (!existsSync(configFile)) {
      mkdirSync(configDir, { recursive: true })
      copyFileSync(initPath, configFile)
    }
  } catch {
    // Config seeding is best-effort.
  }
  const merged = { ...defaults, ...explicit }
  return Object.keys(merged).length > 0 ? merged : undefined
}

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
    const request = rawRequest as { cwd?: unknown; env?: unknown }
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
      .open(cwd, sink, consoleSpawnEnv(request))
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
