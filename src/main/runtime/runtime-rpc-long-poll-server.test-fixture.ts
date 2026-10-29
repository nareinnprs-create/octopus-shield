import { ShieldRuntimeRpcServer } from './runtime-rpc'
import { STATUS_METHODS } from './rpc/methods/status'
import { TERMINAL_METHODS } from './rpc/methods/terminal'
import { ORCHESTRATION_METHODS } from './rpc/methods/orchestration'

export function createLongPollServer(
  options: ConstructorParameters<typeof ShieldRuntimeRpcServer>[0]
) {
  return new ShieldRuntimeRpcServer({
    ...options,
    methods: [...STATUS_METHODS, ...TERMINAL_METHODS, ...ORCHESTRATION_METHODS]
  })
}
