export type OctopodTunnelTransport = 'tcp_forward' | 'stdio_bridge'

const transports = new Map<string, OctopodTunnelTransport>()

export function rememberOctopodTunnelTransport(
  targetId: string,
  transport: OctopodTunnelTransport
): void {
  transports.set(targetId, transport)
}

export function knownOctopodTunnelTransport(targetId: string): OctopodTunnelTransport | null {
  return transports.get(targetId) ?? null
}
