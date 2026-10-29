import { ipcMain } from 'electron'
import type {
  OctopodManagedConversionResult,
  OctopodManagedPendingMigrationRow
} from '../../../shared/octopod-managed-runtime'
import { listPendingManagedOctopodMigrations } from '../../managed-server/lifecycle/octopod-managed-migration-status'
import { convertSshTargetToManagedOctopod } from '../../managed-server/lifecycle/octopod-runtime-conversion'
import { conversionCollaborators } from '../../managed-server/lifecycle/octopod-runtime-conversion-wiring'
import { requiredString } from './octopod-runtime-lifecycle-handlers'

export function registerOctopodRuntimeConversionHandlers(getUserDataPath: () => string): void {
  ipcMain.handle(
    'runtimeEnvironments:convertSshHostToManagedOctopod',
    (
      _event,
      args: { sshTargetId: string; name: string }
    ): Promise<OctopodManagedConversionResult> => {
      return convertSshTargetToManagedOctopod(getUserDataPath(), {
        sshTargetId: requiredString(args?.sshTargetId, 'SSH target'),
        name: requiredString(args?.name, 'Server name'),
        ...conversionCollaborators()
      })
    }
  )
  ipcMain.handle(
    'runtimeEnvironments:listPendingOctopodMigrations',
    (): OctopodManagedPendingMigrationRow[] => listPendingManagedOctopodMigrations(getUserDataPath())
  )
}
