import { getAppEnvironment, hasAppEnvironment } from './app-environment'

export function getShieldCliCommandNameForPlatform(platform: NodeJS.Platform): string {
  if (platform === 'linux') {
    return 'shield-ide'
  }
  if (platform === 'win32') {
    return 'shield.cmd'
  }
  return 'shield'
}

/** The GNOME-conflict `shield-ide` rename is desktop-only: SSH relays and headless Shield servers put plain `shield` on PATH. */
export function skipsLinuxShieldCliRename(isRemote: boolean | undefined): boolean {
  if (isRemote) {
    return true
  }
  // Only a headless server publishes its own launcher; Windows ones (WSL launches) keep the rename.
  const launcher = hasAppEnvironment() ? getAppEnvironment().getCliLauncherPath?.() : null
  return launcher?.endsWith('/shield') ?? false
}
