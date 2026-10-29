// Why: the single security boundary for the bundled CLI — auth-token enforcement, metadata publication, transport orchestration.
import { RuntimeRpcShutdown } from './runtime-rpc/runtime-rpc-shutdown'
import type { ShieldRuntimeRpcServerOptions } from './runtime-rpc/runtime-rpc-pairing-types'

export class ShieldRuntimeRpcServer extends RuntimeRpcShutdown {
  constructor(options: ShieldRuntimeRpcServerOptions) {
    super(options)
  }
}
