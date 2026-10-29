import { ghExecFileAsync, acquire, release } from '../../gh-utils'
export const OSHIELD_REPO = 'octopusshield/octopus-shield'

// Bound optional star prompts more tightly than user work; failures can fall back to the browser.
const STAR_GH_TIMEOUT_MS = 15_000

let inFlightStarCheck: Promise<boolean | null> | null = null

/** null means the star state could not be determined. */
export function checkShieldStarred(): Promise<boolean | null> {
  // Independent UI callers share one probe so optional star prompts cannot exhaust GitHub admission.
  inFlightStarCheck ??= runShieldStarredCheck().finally(() => {
    inFlightStarCheck = null
  })
  return inFlightStarCheck
}

/** @internal Drop any coalesced check so suites cannot inherit one another's. */
export function __resetShieldStarCheckForTests(): void {
  inFlightStarCheck = null
}

async function runShieldStarredCheck(): Promise<boolean | null> {
  await acquire()
  try {
    const { stdout, stderr } = await ghExecFileAsync(
      ['api', '--include', `user/starred/${OSHIELD_REPO}`],
      { encoding: 'utf-8', timeout: STAR_GH_TIMEOUT_MS }
    )
    const response = `${stdout ?? ''}\n${stderr ?? ''}`
    if (/HTTP\/\S+\s+(?:200|204)\b/.test(response)) {
      return true
    }
    return null
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Only a confirmed 404 establishes that the user has not starred.
    if (message.includes('HTTP 404')) {
      return false
    }
    return null
  } finally {
    release()
  }
}

export async function starShield(): Promise<boolean> {
  await acquire()
  try {
    await ghExecFileAsync(['api', '-X', 'PUT', `user/starred/${OSHIELD_REPO}`], {
      encoding: 'utf-8',
      timeout: STAR_GH_TIMEOUT_MS
    })
    return true
  } catch {
    return false
  } finally {
    release()
  }
}
