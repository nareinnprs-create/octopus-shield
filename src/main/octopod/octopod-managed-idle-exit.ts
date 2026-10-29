// Live terminals block idle exit; ordinary shutdown disconnects without killing their daemon.
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { RELAY_INSTALL_LOCK_NAME } from '../../shared/relay-install-lock-name'
import { hasErrorCode } from '../daemon/daemon-process-inspection'
import type { RuntimeRpcClientActivity } from '../runtime/runtime-rpc/runtime-rpc-shutdown'
import { OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/octopod-managed-launch-env'
import { OCTOPOD_IDLE_EXIT_TIMEOUT_MS, readOctopodE2EIdleTimeoutMs } from '../../shared/octopod-idle-exit'
import {
  OctopodIdleExitMonitor,
  type OctopodIdleExitEvidence,
  type OctopodIdleProbe,
  type OctopodIdleVerdict
} from './octopod-idle-exit-monitor'

export type OctopodManagedIdleExitConfig = { timeoutMs: number; activationRoot: string }

/** User-started/paired servers never idle out; only client-managed launches opt in. */
export function resolveOctopodManagedIdleExit(
  env: NodeJS.ProcessEnv
): OctopodManagedIdleExitConfig | null {
  const activationRoot = env[OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV]
  if (!activationRoot) {
    return null
  }
  return {
    timeoutMs: readOctopodE2EIdleTimeoutMs(env) ?? OCTOPOD_IDLE_EXIT_TIMEOUT_MS,
    activationRoot
  }
}

export type OctopodManagedIdleExitPorts = {
  readClientActivity: () => RuntimeRpcClientActivity
  listTerminals: () => Promise<readonly unknown[]>
  /** Null means some daemon generation did not answer. */
  countDaemonSessions: () => Promise<number | null>
  hasDaemon: () => boolean
  agentStates: () => readonly { state: string }[]
  hasChatProviders: () => boolean
  hasStagedMigration: () => boolean
  /** Enabled schedules or unsettled runs would be lost on exit. */
  automationsBusy: () => boolean
  /** Exit would shut down the emulators Shield started for a workspace. */
  emulatorsBusy: () => Promise<boolean>
  activationFenceExists: (root: string) => Promise<boolean>
}

export function createOctopodIdleProbes(
  config: OctopodManagedIdleExitConfig,
  ports: OctopodManagedIdleExitPorts
): OctopodIdleProbe[] {
  const verdict = (busy: boolean): OctopodIdleVerdict => (busy ? 'busy' : 'idle')
  return [
    {
      name: 'clients',
      read: () => {
        const activity = ports.readClientActivity()
        return verdict(activity.openConnections > 0 || activity.requestsInFlight > 0)
      }
    },
    {
      name: 'terminals',
      read: async () => {
        if ((await ports.listTerminals()).length > 0) {
          return 'busy'
        }
        // Daemons may retain sessions absent from this process’s provider inventory.
        if (!ports.hasDaemon()) {
          return 'idle'
        }
        const live = await ports.countDaemonSessions()
        return live === null ? 'unverifiable' : verdict(live > 0)
      }
    },
    {
      name: 'agents',
      read: () => verdict(ports.agentStates().some((entry) => entry.state === 'working'))
    },
    { name: 'chat-providers', read: () => verdict(ports.hasChatProviders()) },
    { name: 'migration', read: () => verdict(ports.hasStagedMigration()) },
    { name: 'automations', read: () => verdict(ports.automationsBusy()) },
    { name: 'emulators', read: async () => verdict(await ports.emulatorsBusy()) },
    {
      name: 'activation',
      read: async () => verdict(await ports.activationFenceExists(config.activationRoot))
    }
  ]
}

/** A bare activation root may be interrupted acquisition; only its lock proves a held fence. */
export async function activationFenceExists(root: string): Promise<boolean> {
  try {
    await stat(join(root, RELAY_INSTALL_LOCK_NAME))
    return true
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) {
      return false
    }
    throw error
  }
}

export function installOctopodManagedIdleExit(input: {
  config: OctopodManagedIdleExitConfig
  ports: OctopodManagedIdleExitPorts
  stop: (evidence: OctopodIdleExitEvidence) => void | boolean | Promise<void | boolean>
}): () => void {
  const monitor = new OctopodIdleExitMonitor({
    timeoutMs: input.config.timeoutMs,
    probes: createOctopodIdleProbes(input.config, input.ports),
    lastClientActivityAt: () => input.ports.readClientActivity().lastRequestAt,
    onIdle: input.stop
  })
  monitor.start()
  return () => monitor.stop()
}
