import { readFileSync } from 'node:fs'
import { Client } from 'pg'

import { PostgresAuditSink, type PgClientLike, type PgResultLike } from './audit-store'

export type PostgresAuditSinkOptions = {
  host: string
  port: number
  database: string
  user: string
  /** Nucleus secret file (infra/.pg_password); contents are connection-only and never logged. */
  passwordFile: string
}

/** Connects on first query so constructing the sink stays side-effect free. */
class LazyConnectedPgClient implements PgClientLike {
  private connected = false

  constructor(private readonly client: Client) {}

  async query(text: string, values?: readonly unknown[]): Promise<PgResultLike> {
    if (!this.connected) {
      await this.client.connect()
      this.connected = true
    }
    return this.client.query(text, values === undefined ? undefined : [...values])
  }

  async close(): Promise<void> {
    if (!this.connected) {
      return
    }
    this.connected = false
    await this.client.end()
  }
}

export class PgAuditSink extends PostgresAuditSink {
  private readonly connection: LazyConnectedPgClient

  constructor(options: PostgresAuditSinkOptions) {
    const connection = new LazyConnectedPgClient(
      new Client({
        host: options.host,
        port: options.port,
        database: options.database,
        user: options.user,
        password: readFileSync(options.passwordFile, 'utf8').trim()
      })
    )
    super(connection)
    this.connection = connection
  }

  close(): Promise<void> {
    return this.connection.close()
  }
}

export function createPostgresAuditSink(options: PostgresAuditSinkOptions): PgAuditSink {
  return new PgAuditSink(options)
}
