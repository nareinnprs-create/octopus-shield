import type { ShieldCloudSignInProgress } from '../../shared/shield-profiles'

type ProgressListener = (progress: ShieldCloudSignInProgress | null) => void

// Only the newest attempt owns progress; late updates from older attempts are ignored.
let current: { attempt: number; link: string | null; cancel: () => void } | null = null
const listeners = new Set<ProgressListener>()

function snapshot(): ShieldCloudSignInProgress | null {
  return current ? { link: current.link } : null
}

function update(next: typeof current): void {
  current = next
  const progress = snapshot()
  for (const listener of listeners) {
    try {
      listener(progress)
    } catch (error) {
      console.warn('[shield-profiles] Sign-in progress listener failed:', error)
    }
  }
}

export function getShieldCloudSignInProgress(): ShieldCloudSignInProgress | null {
  return snapshot()
}

export function onShieldCloudSignInProgressChanged(listener: ProgressListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function startShieldCloudSignInProgress(attempt: number, cancel: () => void): void {
  update({ attempt, link: null, cancel })
}

export function setShieldCloudSignInLink(attempt: number, link: string | null): void {
  if (current?.attempt === attempt && current.link !== link) {
    update({ ...current, link })
  }
}

export function endShieldCloudSignInProgress(attempt?: number): void {
  if (current && (attempt === undefined || current.attempt === attempt)) {
    update(null)
  }
}

export function cancelShieldCloudSignIn(): void {
  current?.cancel()
}
