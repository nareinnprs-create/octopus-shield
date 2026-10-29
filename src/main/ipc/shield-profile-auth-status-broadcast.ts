import { BrowserWindow } from 'electron'
import {
  OSHIELD_PROFILE_AUTH_STATUS_CHANGED_CHANNEL,
  OSHIELD_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL,
  type ShieldCloudSignInProgress
} from '../../shared/shield-profiles'

function broadcast(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue
    }
    try {
      window.webContents.send(channel, ...args)
    } catch {
      // A renderer can disappear between isDestroyed() and send().
    }
  }
}

export function broadcastShieldProfileAuthStatusChanged(): void {
  broadcast(OSHIELD_PROFILE_AUTH_STATUS_CHANGED_CHANNEL)
}

export function broadcastShieldProfileSignInProgressChanged(
  progress: ShieldCloudSignInProgress | null
): void {
  broadcast(OSHIELD_PROFILE_SIGN_IN_PROGRESS_CHANGED_CHANNEL, progress)
}
