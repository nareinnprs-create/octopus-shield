import type { Store } from '../persistence'
import type { ShieldRuntimeService } from '../runtime/shield-runtime'
import { registerSshHandlers } from '../ipc/ssh/ssh'
import { mainProcessState as state } from './main-process-state'

/** Register SSH before any window so headless serve can list/connect targets (#25886, #8489); later window registration is idempotent. */
export function registerHeadlessServeSshHandlers(store: Store, runtime: ShieldRuntimeService): void {
  registerSshHandlers(store, () => state.mainWindow ?? null, runtime)
}
