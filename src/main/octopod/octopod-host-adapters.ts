import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { OCTOPOD_CLI_PACKAGE_FILENAME } from '../../shared/octopod-artifacts'
import { setAppEnvironment, type AppEnvironment } from '../../shared/app-environment'
import { setSecretStore } from '../../shared/secret-store'
import { resolveOctopodInstallRoot, resolveOctopodPath } from './octopod-app-paths'
import { getOctopodCliLauncherPath } from './octopod-cli-launcher'
import { createOctopodSecretStore, type OctopodSecretStore } from './octopod-secret-store'
import { setSpeechServiceFactories } from '../speech/speech-runtime-service'
import { octopodSpeechServiceFactories } from './octopod-speech-services'

let quitRegisteredHandlers = (): void => {}

export function runOctopodQuitHandlers(): void {
  quitRegisteredHandlers()
}

function createNodeAppEnvironment(): AppEnvironment {
  const quitHandlers: (() => void)[] = []
  // Synchronous quit handlers must not preempt the signal handler’s awaited runtime/browser teardown.
  quitRegisteredHandlers = (): void => {
    const errors: unknown[] = []
    for (const handler of quitHandlers.splice(0)) {
      try {
        handler()
      } catch (error) {
        errors.push(error)
      }
    }
    // Failed handlers may leave writers running and keep the instance lock held.
    if (errors.length > 0) {
      throw new AggregateError(errors, 'octopod_quit_handlers_failed')
    }
  }
  return {
    getPath: resolveOctopodPath,
    getAppPath: () => resolveOctopodInstallRoot(),
    getVersion: () => process.env.OSHIELD_VERSION ?? '0.0.0-octopod',
    // Packaged gates production HTTPS/CLI/PATH policy; layout callers must inspect asar separately.
    isPackaged: () => true,
    getCliLauncherPath: getOctopodCliLauncherPath,
    onWillQuit: (handler) => quitHandlers.push(handler),
    exit: (code = 0) => process.exit(code),
    getAppMetrics: () => []
  }
}

let octopodSecretStore: OctopodSecretStore | null = null

export async function prepareOctopodSecretStore(
  keyDir: string,
  userDataPath: string
): Promise<boolean> {
  if (!octopodSecretStore) {
    throw new Error('octopod_secret_store_not_installed — call installOctopodHostAdapters() first')
  }
  return octopodSecretStore.prepare({ keyDir, userDataPath })
}

/** Stamp the bundle’s own release so inherited desktop versions cannot misidentify this server. */
export function stampOctopodAppVersion(installRoot: () => string = resolveOctopodInstallRoot): void {
  let version: unknown
  try {
    const path = join(installRoot(), ...OCTOPOD_CLI_PACKAGE_FILENAME.split('/'))
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    version = parsed && typeof parsed === 'object' && 'version' in parsed ? parsed.version : null
  } catch {
    return
  }
  if (typeof version === 'string' && version.length > 0) {
    process.env.OSHIELD_APP_VERSION = version
  }
}

export function installOctopodHostAdapters(): void {
  stampOctopodAppVersion()
  setAppEnvironment(createNodeAppEnvironment())
  octopodSecretStore = createOctopodSecretStore()
  setSecretStore(octopodSecretStore)
  setSpeechServiceFactories(octopodSpeechServiceFactories)
}
