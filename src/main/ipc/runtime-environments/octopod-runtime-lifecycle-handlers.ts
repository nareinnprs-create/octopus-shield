import { ipcMain } from 'electron'
import type { OctopodManagedRuntimeStatus } from '../../../shared/octopod-managed-runtime'
import { createManagedOctopodEnvironment } from '../../managed-server/lifecycle/octopod-runtime-deployment'
import { getManagedOctopodRuntimeStatus } from '../../managed-server/lifecycle/octopod-runtime-status'

export function registerOctopodRuntimeLifecycleHandlers(options: {
  getUserDataPath: () => string
}): void {
  ipcMain.handle(
    'runtimeEnvironments:deployOctopod',
    async (_event, args: { name: string; sshTargetId: string; force?: boolean }) =>
      createManagedOctopodEnvironment(options.getUserDataPath(), {
        name: requiredString(args?.name, 'Server name'),
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        force: args?.force === true
      })
  )
  ipcMain.handle(
    'runtimeEnvironments:getOctopodStatus',
    (_event, args: { selector: string }): Promise<OctopodManagedRuntimeStatus> =>
      getManagedOctopodRuntimeStatus(
        options.getUserDataPath(),
        requiredString(args?.selector, 'Server')
      )
  )
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`)
  }
  return value.trim()
}
