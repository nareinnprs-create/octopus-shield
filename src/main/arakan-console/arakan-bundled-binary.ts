// Why: packaged installs ship a version-matched arakan binary; a PATH arakan may be missing or stale.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { TuiAgent } from '../../shared/tui-agent'

/** Bundled `arakan` TUI spawn path for this platform slice, or null when this install ships none. */
export function resolveArakanSpawnCommand(
  platform: NodeJS.Platform,
  arch: string,
  isPackaged: boolean
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
  const root = isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const candidate = join(root, 'arakan', 'bin', dir, exe)
  return existsSync(candidate) ? candidate : null
}

/** A plain `arakan` launch becomes the bundled binary when one ships; overrides and other agents pass through. */
export function arakanBundledLaunchCommand(agent: TuiAgent, launchCommand: string): string | null {
  if (agent !== 'arakan' || launchCommand.trim() !== 'arakan') {
    return null
  }
  const bundled = resolveArakanSpawnCommand(process.platform, process.arch, app.isPackaged)
  if (!bundled) {
    return null
  }
  return /\s/.test(bundled) ? `"${bundled}"` : bundled
}
