import '../memory/host-malloc-tunables-claim'
import process from 'node:process'
import { main } from './octopod-entry'
import { resolveOctopodExitCode } from './octopod-exit-code'
import { reserveServeStdoutForReadiness } from '../server/serve-stdout-boundary'
import { runOctopodNativePreflight } from './octopod-native-preflight'
import {
  OCTOPOD_PROFILE_PREFLIGHT_FLAG,
  OCTOPOD_STARTUP_PREFLIGHT_FLAG
} from '../../shared/octopod-profile-preflight'
import { preflightBundledOctopodStartup, runOctopodProfilePreflight } from './octopod-profile-preflight'
import { assertOctopodServerRuntime } from './octopod-bundled-runtime'
import {
  formatOctopodNativePreflightReport,
  OCTOPOD_NATIVE_PREFLIGHT_FLAG
} from '../../shared/octopod-native-preflight-report'
import {
  OCTOPOD_CANCEL_MANAGED_STOP_FLAG,
  OCTOPOD_COMPLETE_MANAGED_STOP_FLAG
} from '../../shared/octopod-stop-request'
import {
  OCTOPOD_WINDOWS_BREAKAWAY_CONTRACT,
  WINDOWS_BREAKAWAY_LAUNCH_FLAG
} from '../../shared/windows-breakaway-launch'
import { runWindowsBreakawayLaunchIfRequested } from '../../shared/windows-breakaway-launcher'
import { parseArgs } from './octopod-command-arguments'
import { OCTOPOD_RECLAIM_STALE_LOCK_FLAG } from '../../shared/octopod-stale-lock-reclaim'

// A resolved plain-Node module graph proves the build guard; skip probes, ports and data-root locks.
if (process.argv.includes('--octopod-smoke-load-check')) {
  process.exit(0)
}

function failStartup(error: unknown): void {
  console.error('octopod: failed to start:', error)
  // Distinguish configuration refusals so supervisors cannot restart-spin on them.
  process.exit(resolveOctopodExitCode(error))
}

// One-shot launch and stop commands must skip server startup and preflights.
if (process.argv[2] === '--octopod-structured-provider-load-check') {
  void import('./octopod-structured-provider-smoke')
    .then(({ smokeLoadOctopodStructuredProviders }) => smokeLoadOctopodStructuredProviders())
    .then(() => process.exit(0))
    .catch(failStartup)
} else if (process.argv[2] === WINDOWS_BREAKAWAY_LAUNCH_FLAG) {
  runWindowsBreakawayLaunchIfRequested(OCTOPOD_WINDOWS_BREAKAWAY_CONTRACT, process.argv)
} else if (
  process.argv[2] === OCTOPOD_COMPLETE_MANAGED_STOP_FLAG ||
  process.argv[2] === OCTOPOD_CANCEL_MANAGED_STOP_FLAG
) {
  void import('./octopod-managed-stop-command').then(({ runOctopodManagedStopCommandAndExit }) =>
    runOctopodManagedStopCommandAndExit(process.argv.slice(2))
  )
} else if (process.argv[2] === OCTOPOD_RECLAIM_STALE_LOCK_FLAG) {
  void import('./octopod-stale-lock-reclaim').then(({ runOctopodStaleLockReclaimCommandAndExit }) =>
    runOctopodStaleLockReclaimCommandAndExit(process.argv.slice(2))
  )
} else {
  startOctopodProcess()
}

function startOctopodProcess(): void {
  try {
    const argv = process.argv.slice(2)
    if ((argv.includes('--help') || argv.includes('-h')) && parseArgs(argv).help) {
      void main(argv).catch(failStartup)
      return
    }
    assertOctopodServerRuntime()
    const flag = process.argv[2]
    if (flag === OCTOPOD_NATIVE_PREFLIGHT_FLAG && process.argv.length === 3) {
      void import('./node-pty-precondition').then(({ checkNodePtyPrecondition }) => {
        const verdict = checkNodePtyPrecondition()
        const report = formatOctopodNativePreflightReport(verdict.status, verdict.reason ?? null)
        process.stdout.write(`${report}\n`, () => process.exit(0))
      }, failStartup)
    } else if (
      (flag === OCTOPOD_PROFILE_PREFLIGHT_FLAG || flag === OCTOPOD_STARTUP_PREFLIGHT_FLAG) &&
      process.argv.length === 4
    ) {
      void runOctopodProfilePreflight(process.argv[3], {
        nativeFeatures: flag === OCTOPOD_PROFILE_PREFLIGHT_FLAG
      })
        // The owner reads EOF; lingering native handles must not keep this probe alive.
        .then(() => process.stdout.write('', () => process.exit(0)))
        .catch(failStartup)
    } else {
      // Stdout is the readiness API; send incidental diagnostics to stderr.
      reserveServeStdoutForReadiness()
      void preflightBundledOctopodStartup()
        .then(() => {
          // Probe before deferred node-pty loading can crash this process.
          runOctopodNativePreflight()
          return main()
        })
        .catch(failStartup)
    }
  } catch (error) {
    failStartup(error)
  }
}
