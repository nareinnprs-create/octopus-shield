// oxlint-disable max-lines
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type {
  ArakanConsoleEvent,
  ArakanConsolePermissionRequest,
  ArakanConsolePermissionResponse
} from '../../shared/arakan-console-contract'

const ACP_PROTOCOL_VERSION = 1
const PERMISSION_TIMEOUT_MS = 120_000

export type ArakanConsoleEventSink = (event: ArakanConsoleEvent) => void

type PendingRequest = {
  resolve: (value: Record<string, unknown>) => void
  reject: (reason: Error) => void
  timer: NodeJS.Timeout
}

export function resolveArakanBinary(): string | null {
  const exe = process.platform === 'win32' ? 'arakan.exe' : 'arakan'
  const subdir =
    process.platform === 'win32'
      ? 'win-x64'
      : process.platform === 'darwin'
        ? process.arch === 'arm64'
          ? 'mac-arm64'
          : 'mac-x64'
        : 'linux-x64'
  const resourcesPath =
    process.resourcesPath ??
    (process.platform === 'darwin'
      ? join(app.getPath('exe'), '..', '..', 'Resources')
      : join(app.getPath('exe'), '..', 'resources'))
  const candidates = [
    join(resourcesPath, 'arakan', 'bin', subdir, exe),
    join(app.getAppPath(), 'resources', 'arakan', 'bin', subdir, exe),
    join(app.getAppPath(), '..', 'arakan', 'target', 'debug', exe)
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export class ArakanConsoleService {
  private child: ChildProcess | null = null
  private stdoutBuffer = ''
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingRequest>()
  private readonly permissionTimers = new Map<string, NodeJS.Timeout>()
  private sink: ArakanConsoleEventSink | null = null
  private acpSessionId: string | null = null
  private backendVersion: string | null = null

  isOpen(): boolean {
    return this.child !== null && this.acpSessionId !== null
  }

  async open(
    cwd: string,
    sink: ArakanConsoleEventSink,
    extraEnv?: Record<string, string>
  ): Promise<{ sessionId: string; backendVersion: string | null }> {
    if (this.child) {
      this.close('reopened')
    }
    const binary = resolveArakanBinary()
    if (binary === null) {
      throw new Error('arakan binary not found (not bundled and no dev build present)')
    }
    this.sink = sink
    this.child = spawn(binary, ['acp'], {
      cwd,
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(extraEnv === undefined ? {} : { env: { ...process.env, ...extraEnv } })
    })
    this.child.stdout?.setEncoding('utf8')
    this.child.stdout?.on('data', (chunk: string) => this.onStdout(chunk))
    this.child.stderr?.setEncoding('utf8')
    this.child.stderr?.on('data', (chunk: string) => {
      const text = chunk.trim()
      if (text.length > 0) {
        this.emit({ kind: 'notice', text })
      }
    })
    this.child.on('error', (error) => {
      this.emit({ kind: 'notice', text: `arakan acp failed to start: ${error.message}` })
      this.emit({ kind: 'exited', code: null, reason: 'process error' })
      this.teardown('process error')
    })
    this.child.on('exit', (code) => {
      this.emit({ kind: 'exited', code, reason: 'process exited' })
      this.teardown('exited')
    })

    try {
      const initResult = await this.request('initialize', { protocolVersion: ACP_PROTOCOL_VERSION })
      this.backendVersion =
        typeof initResult.protocolVersion === 'string' ? initResult.protocolVersion : null
      const newSession = await this.request('session/new', { cwd, mcpServers: [] }).catch(
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('timeout')) {
            throw new Error(
              'arakan session timed out resolving its provider — verify the provider/model in ~/.arakan/config.yaml or Neuro settings and its credentials, then reopen the Console'
            )
          }
          throw error
        }
      )
      this.acpSessionId =
        typeof newSession.sessionId === 'string' ? newSession.sessionId : `arakan-${Date.now()}`
      return { sessionId: this.acpSessionId, backendVersion: this.backendVersion }
    } catch (error) {
      this.close('startup failed')
      throw error
    }
  }

  async prompt(text: string): Promise<void> {
    if (this.child === null || this.acpSessionId === null) {
      throw new Error('console is not open')
    }
    await this.request('session/prompt', {
      sessionId: this.acpSessionId,
      prompt: [{ type: 'text', text }]
    })
  }

  respondPermission(response: ArakanConsolePermissionResponse): boolean {
    const pending = this.pendingPermission.get(response.requestId)
    if (pending === undefined) {
      return false
    }
    this.clearPermissionTimer(String(response.requestId))
    this.pendingPermission.delete(response.requestId)
    this.respond(response.requestId, {
      outcome: { optionId: response.optionId, outcome: 'selected' }
    })
    return true
  }

  private readonly pendingPermission = new Map<string | number, ArakanConsolePermissionRequest>()

  private clearPermissionTimer(id: string): void {
    const timer = this.permissionTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.permissionTimers.delete(id)
    }
  }

  close(reason: string): void {
    const child = this.child
    this.teardown(reason)
    if (child !== null) {
      try {
        child.kill()
      } catch {}
    }
  }

  private teardown(reason: string): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error(`arakan acp closed: ${reason}`))
    }
    this.pending.clear()
    for (const [, timer] of this.permissionTimers) {
      clearTimeout(timer)
    }
    this.permissionTimers.clear()
    this.pendingPermission.clear()
    this.stdoutBuffer = ''
    this.acpSessionId = null
    this.backendVersion = null
    this.child = null
    this.sink = null
  }

  private emit(event: ArakanConsoleEvent): void {
    this.sink?.(event)
  }

  private onStdout(chunk: string): void {
    this.stdoutBuffer += chunk
    let newlineAt = this.stdoutBuffer.indexOf('\n')
    while (newlineAt !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineAt).trim()
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineAt + 1)
      if (line.length > 0) {
        this.onMessageLine(line)
      }
      newlineAt = this.stdoutBuffer.indexOf('\n')
    }
  }

  private onMessageLine(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      this.emit({ kind: 'notice', text: `unparsable line: ${line.slice(0, 120)}` })
      return
    }
    if (typeof message.id === 'number' && ('result' in message || 'error' in message)) {
      const pending = this.pending.get(message.id)
      if (pending !== undefined) {
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        if ('error' in message) {
          pending.reject(new Error(JSON.stringify(message.error).slice(0, 200)))
        } else {
          pending.resolve((message.result ?? {}) as Record<string, unknown>)
        }
      }
      return
    }
    this.onNotification(message)
  }

  private onNotification(message: Record<string, unknown>): void {
    const method = typeof message.method === 'string' ? message.method : ''
    if (method === 'session/requestPermission' || method === 'requestPermission') {
      this.onPermissionRequest(message)
      return
    }
    const params = (message.params ?? message) as Record<string, unknown>
    const update = (params.update ?? params) as Record<string, unknown>
    const updateKind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : method
    if (updateKind.includes('agentMessageChunk') || updateKind.includes('agent_message_chunk')) {
      const content = update.content as { text?: string } | undefined
      this.emit({ kind: 'agent-message', text: content?.text ?? '', raw: message })
      return
    }
    if (updateKind.includes('tool_call')) {
      const toolCallId = typeof update.toolCallId === 'string' ? update.toolCallId : ''
      const title =
        typeof update.title === 'string'
          ? update.title
          : typeof (update.toolCall as { title?: string } | undefined)?.title === 'string'
            ? (update.toolCall as { title: string }).title
            : toolCallId
      const status = typeof update.status === 'string' ? update.status : undefined
      const output =
        typeof update.content === 'string'
          ? update.content
          : typeof update.rawOutput === 'string'
            ? update.rawOutput
            : undefined
      this.emit(
        updateKind.includes('update')
          ? { kind: 'tool-call-update', toolCallId, title, status, output, raw: message }
          : { kind: 'tool-call', toolCallId, title, status, raw: message }
      )
    }
    if (updateKind.includes('turn') && updateKind.includes('complete')) {
      this.emit({ kind: 'turn-complete', raw: message })
    }
  }

  private onPermissionRequest(message: Record<string, unknown>): void {
    const params = (message.params ?? {}) as Record<string, unknown>
    const rawId =
      typeof message.id === 'number' || typeof message.id === 'string'
        ? message.id
        : this.nextRequestId++
    const toolCall = params.toolCall as { title?: string; kind?: string } | undefined
    const options = Array.isArray(params.options)
      ? (params.options as Record<string, unknown>[]).map((option) => ({
          optionId: String(option.optionId ?? option.kind ?? ''),
          kind: String(option.kind ?? ''),
          ...(typeof option.name === 'string' ? { name: option.name } : {})
        }))
      : []
    const request: ArakanConsolePermissionRequest = {
      requestId: rawId,
      ...(toolCall?.title === undefined ? {} : { toolCallTitle: toolCall.title }),
      ...(toolCall?.kind === undefined ? {} : { kind: toolCall.kind }),
      options
    }
    this.pendingPermission.set(rawId, request)
    const timer = setTimeout(() => {
      const deny = options.find((option) => option.kind.includes('reject')) ?? options[0]
      if (deny !== undefined) {
        this.respondPermission({ requestId: rawId, optionId: deny.optionId })
      }
      this.emit({ kind: 'notice', text: 'permission request timed out — denied' })
    }, PERMISSION_TIMEOUT_MS)
    this.permissionTimers.set(String(rawId), timer)
    this.emit({ kind: 'permission-request', request })
  }

  private request(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const child = this.child
    if (child === null || child.stdin === null) {
      return Promise.reject(new Error('arakan acp not running'))
    }
    const id = this.nextRequestId++
    const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`arakan acp timeout on ${method}`))
      }, 30_000)
      this.pending.set(id, { resolve, reject, timer })
      const stdin = child.stdin
      if (stdin === null || stdin === undefined) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('arakan acp stdin unavailable'))
        return
      }
      try {
        stdin.write(payload)
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  private respond(id: number | string, result: Record<string, unknown>): void {
    const child = this.child
    if (child?.stdin === null || child?.stdin === undefined) {
      return
    }
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
  }
}
