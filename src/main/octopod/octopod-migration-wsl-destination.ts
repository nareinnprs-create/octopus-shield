// In-place WSL moves require the desktop-launched octopod in the source distro to own the unchanged paths.
import type { OctopodMigrationManifestSource } from '../../shared/octopod-migration/octopod-migration-manifest'
import { isOctopodMigrationLocalWslSource } from '../../shared/octopod-migration/octopod-migration-source-kind'
import { isWslHostOctopodProcess } from '../ipc/wsl-guest-windows-drive-path'

export const OCTOPOD_MIGRATION_SOURCE_NOT_THIS_HOST = 'octopod_migration_source_not_this_host'

/** Desktop-provided registry ID; guests cannot read it themselves. */
export const OCTOPOD_WSL_DISTRO_GUID_ENV = 'OSHIELD_WSL_DISTRO_GUID'

export function servesLocalWslMigrationSource(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): boolean {
  return isWslHostOctopodProcess(env, platform)
}

export function assertOctopodMigrationSourceServedHere(
  source: OctopodMigrationManifestSource,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): void {
  if (!isOctopodMigrationLocalWslSource(source)) {
    return
  }
  // WSL distro names and their UNC forms are case-insensitive.
  const distro = env.WSL_DISTRO_NAME?.trim().toLowerCase()
  if (!servesLocalWslMigrationSource(env, platform) || distro !== source.distro.toLowerCase()) {
    throw new Error(OCTOPOD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
  // Re-registering a distro reuses its name, not its files; require its registry ID when supplied.
  const guid = env[OCTOPOD_WSL_DISTRO_GUID_ENV]?.trim().toLowerCase()
  if (source.distroGuid !== undefined && guid !== source.distroGuid.toLowerCase()) {
    throw new Error(OCTOPOD_MIGRATION_SOURCE_NOT_THIS_HOST)
  }
}
