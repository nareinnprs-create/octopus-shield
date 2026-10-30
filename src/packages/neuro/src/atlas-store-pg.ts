import { readFileSync } from 'node:fs'
import { Client } from 'pg'

import type { NeuroClient, NeuroQueryResult } from './atlas-indexer'

export type NeuroPgOptions = {
  host: string
  port: number
  database: string
  user: string
  /** Nucleus secret file (infra/.pg_password); contents are connection-only and never logged. */
  passwordFile: string
}

/** Connects on first query so constructing the client stays side-effect free (audit-store pattern). */
class LazyConnectedPgClient implements NeuroClient {
  private connected = false
  /** Idle-socket resets would otherwise crash the process as an unhandled 'error' event. */
  private socketError: Error | null = null

  constructor(private readonly client: Client) {
    client.on('error', (error: Error) => {
      this.socketError = error
    })
  }

  async query(text: string, values?: readonly unknown[]): Promise<NeuroQueryResult> {
    if (this.socketError) {
      const error = this.socketError
      this.socketError = null
      this.connected = false
      throw error
    }
    if (!this.connected) {
      await this.client.connect()
      this.connected = true
    }
    const result = await this.client.query(text, values === undefined ? undefined : [...values])
    return { rowCount: result.rowCount, rows: result.rows as Record<string, unknown>[] }
  }

  async close(): Promise<void> {
    if (this.socketError) {
      this.socketError = null
      this.connected = false
      return
    }
    if (!this.connected) {
      return
    }
    this.connected = false
    await this.client.end()
  }
}

export type NeuroPgHandle = {
  client: NeuroClient
  close(): Promise<void>
}

export function createNeuroPgClient(options: NeuroPgOptions): NeuroPgHandle {
  const connection = new LazyConnectedPgClient(
    new Client({
      host: options.host,
      port: options.port,
      database: options.database,
      user: options.user,
      password: readFileSync(options.passwordFile, 'utf8').trim()
    })
  )
  return { client: connection, close: () => connection.close() }
}
