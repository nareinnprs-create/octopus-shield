/** Push selected distro account homes on connect/selection changes so host-initiated CLI, automation, chat and text-generation launches use the same account. */
import type { HostAccountLaunchEnv } from '../../shared/host-account-launch-env'
import { HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY } from '../../shared/octopod-runtime-capabilities'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { RuntimeRpcResponse } from '../../shared/runtime-rpc-envelope'
import {
  distroTarget,
  getWslOctopodAccountEnvDependencies,
  prepareWslOctopodAccountEnv,
  type WslOctopodAccountEnvDependencies
} from './wsl-octopod-account-env'
import type { WslOctopodHostCapabilityVerdict } from './wsl-octopod-host-environments'
import { runKeyedSerializedOperation } from '../cli/keyed-promise-queue'

export type WslOctopodHostAccountPush = {
  environmentId: string
  distro: string
  hostSupports: (capability: string) => Promise<WslOctopodHostCapabilityVerdict>
  call: (method: string, params: unknown) => Promise<RuntimeRpcResponse<unknown>>
}

/** The settings whose change can move a distro's selected Claude or Codex account. */
export const WSL_HOST_ACCOUNT_SETTING_KEYS = [
  'activeClaudeManagedAccountId',
  'activeClaudeManagedAccountIdsByRuntime',
  'claudeManagedAccounts',
  'activeCodexManagedAccountId',
  'activeCodexManagedAccountIdsByRuntime',
  'codexManagedAccounts'
] as const satisfies readonly (keyof GlobalSettings)[]

export function changesWslHostAccounts(updates: Partial<GlobalSettings>): boolean {
  return WSL_HOST_ACCOUNT_SETTING_KEYS.some((key) => key in updates)
}

export async function prepareWslOctopodHostLaunchEnv(
  distro: string,
  dependencies: WslOctopodAccountEnvDependencies
): Promise<HostAccountLaunchEnv> {
  return {
    wslDistro: distro,
    claude: await prepareWslOctopodAccountEnv(distro, 'claude', dependencies),
    terminal: await prepareWslOctopodAccountEnv(distro, null, dependencies)
  }
}

async function pushOnce(
  push: WslOctopodHostAccountPush,
  dependencies: WslOctopodAccountEnvDependencies
): Promise<void> {
  const verdict = await push.hostSupports(HOST_ACCOUNT_LAUNCH_ENV_RUNTIME_CAPABILITY)
  if (verdict === 'unknown') {
    // Unknown capabilities are not proof of an old host; fail so the push retries.
    throw new Error('The host did not report its capabilities.')
  }
  if (verdict === 'unsupported') {
    if (dependencies.managedAccountSelected(distroTarget(push.distro))) {
      dependencies.accountNotApplied(push.distro)
    }
    return
  }
  const launchEnv = await prepareWslOctopodHostLaunchEnv(push.distro, dependencies)
  const response = await push.call('accounts.setHostLaunchEnv', launchEnv)
  if (!response.ok) {
    throw new Error(response.error.message)
  }
}

const pending = new Map<string, Promise<void>>()
const generations = new Map<string, number>()
/** A failed push is retried, since the host otherwise keeps the old account until it reconnects. */
const RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const

/** Serialized per host, so an older selection can never land after a newer one. */
export function pushWslOctopodHostAccountEnv(
  push: WslOctopodHostAccountPush,
  dependencies: WslOctopodAccountEnvDependencies | null = getWslOctopodAccountEnvDependencies(),
  retryDelaysMs: readonly number[] = RETRY_DELAYS_MS
): Promise<void> {
  if (!dependencies) {
    return Promise.resolve()
  }
  const generation = (generations.get(push.environmentId) ?? 0) + 1
  generations.set(push.environmentId, generation)
  return enqueue(push, dependencies, retryDelaysMs, generation, 0)
}

function enqueue(
  push: WslOctopodHostAccountPush,
  dependencies: WslOctopodAccountEnvDependencies,
  retryDelaysMs: readonly number[],
  generation: number,
  attempt: number
): Promise<void> {
  return runKeyedSerializedOperation(pending, push.environmentId, () =>
    pushOnce(push, dependencies)
  ).catch((error: unknown) => {
    // Retain the last host account on failure; clearing it would launch under another account.
    console.warn(`[wsl-hosts] Could not give ${push.distro} its selected accounts:`, error)
    const delay = retryDelaysMs[attempt]
    if (delay === undefined) {
      return
    }
    const timer = setTimeout(() => {
      // A newer push already carries the current selection.
      if (generations.get(push.environmentId) === generation) {
        void enqueue(push, dependencies, retryDelaysMs, generation, attempt + 1)
      }
    }, delay)
    timer.unref?.()
  })
}
