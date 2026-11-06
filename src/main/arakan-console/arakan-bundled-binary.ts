// Why: packaged installs ship a version-matched arakan binary; a PATH arakan may be missing or stale.
// NOTE: no electron import here — this module sits in the octopod node-bundle graph, which forbids
// them. `process.resourcesPath`/`process.execPath` are Electron-main globals, no import required.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { TuiAgent } from '../../shared/tui-agent'

const isPackagedElectron = (): boolean =>
  process.resourcesPath !== undefined &&
  !process.execPath.includes('node_modules') &&
  !process.execPath.includes('electron')

/** Bundled `arakan` TUI spawn path for this platform slice, or null when this install ships none. */
export function resolveArakanSpawnCommand(
  platform: NodeJS.Platform,
  arch: string,
  isPackaged = isPackagedElectron()
): string | null {
  const dir =
    platform === 'win32'
      ? 'win-x64'
      : platform === 'darwin'
        ? arch === 'arm64'
          ? 'mac-arm64'
          : 'mac-x64'
        : 'linux-x64'
  const exe = platform === 'win32' ? 'arakan.exe' : 'arakan'
  // Bundled-first mirrors arakan-console-service: a PATH arakan only runs when this install ships none.
  const resourcesRoot = isPackaged
    ? (process.resourcesPath ?? join(process.cwd(), 'resources'))
    : (process.env.OSHIELD_DEV_RESOURCES ?? join(process.cwd(), 'resources'))
  const candidate = join(resourcesRoot, 'arakan', 'bin', dir, exe)
  return existsSync(candidate) ? candidate : null
}

/** A plain `arakan` launch becomes the bundled binary when one ships; overrides and other agents pass through. */
export function arakanBundledLaunchCommand(agent: TuiAgent, launchCommand: string): string | null {
  if (agent !== 'arakan' || launchCommand.trim() !== 'arakan') {
    return null
  }
  const bundled = resolveArakanSpawnCommand(process.platform, process.arch)
  if (!bundled) {
    return null
  }
  return /\s/.test(bundled) ? `"${bundled}"` : bundled
}
