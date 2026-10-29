import type { OctopodHostTransport } from './octopod-host-transport'
import type { SshConnection } from './connection/ssh-connection'

/** Return the connection object itself: tunnel ownership, dedupe and caches depend on its identity. */
export function sshOctopodHostTransport(connection: SshConnection): OctopodHostTransport {
  return connection
}
