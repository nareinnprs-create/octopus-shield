import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { preflightProfileStateRuntime } from '../persistence/profile-state/profile-state-runtime-preflight'
import {
  OCTOPOD_STARTUP_PREFLIGHT_FLAG,
  OCTOPOD_PROFILE_PREFLIGHT_TIMEOUT_MS,
  parseOctopodProfilePreflight,
  octopodProfilePreflightResponseSchema,
  type OctopodProfilePreflightResponse
} from '../../shared/octopod-profile-preflight'
import { readOctopodArtifactIdentity } from './octopod-artifact-identity'
import { OCTOPOD_EXIT_CONFIGURATION } from './octopod-configuration-exit'
import { OCTOPOD_SERVER_ENTRY_FILENAME, OCTOPOD_VERSION_FILENAME } from '../../shared/octopod-artifacts'
import { OCTOPOD_NODE_RUNTIME_IDENTITY } from '../../shared/octopod-node-runtime-identity'
import { runProcess } from '@shield/process-host'
import { preflightOctopodNativeRuntime } from './octopod-runtime-native-preflight'
import { octopodCompileCacheEnv } from './octopod-compile-cache'
import {
  isRunningAsBundledOctopodRuntime,
  OctopodBundledRuntimeError,
  resolveBundledOctopodSlot
} from './octopod-bundled-runtime'

/** Qualify packaged startup before touching profile indexes, data-root locks or imports. */
export async function preflightBundledOctopodStartup(): Promise<void> {
  const directory = resolveBundledOctopodSlot()
  if (!isRunningAsBundledOctopodRuntime(directory)) {
    return
  }
  const identity = await readInstalledVersion(directory)
  const nonce = randomUUID()
  // Keep disposable SQLite ownership and native state out of the serving process.
  const result = await runProcess({
    program: process.execPath,
    args: [join(directory, OCTOPOD_SERVER_ENTRY_FILENAME), OCTOPOD_STARTUP_PREFLIGHT_FLAG, nonce],
    // Reuse the serving runtime code cache for this identical bundle.
    env: { ...process.env, OSHIELD_BACKGROUND_LAUNCH: '1', ...octopodCompileCacheEnv(directory) },
    timeoutMs: OCTOPOD_PROFILE_PREFLIGHT_TIMEOUT_MS,
    maxOutputBytes: 64 * 1024,
    terminationBarrier: true
  })
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    const Failure = result.code === OCTOPOD_EXIT_CONFIGURATION ? OctopodBundledRuntimeError : Error
    throw new Failure(`The bundled Shield runtime failed readiness: ${result.stderr}`)
  }
  try {
    parseOctopodProfilePreflight(result.stdout, nonce, OCTOPOD_NODE_RUNTIME_IDENTITY, identity)
  } catch (cause) {
    throw new OctopodBundledRuntimeError('The bundled runtime returned invalid readiness identity', {
      cause
    })
  }
}

export async function runOctopodProfilePreflight(
  nonce: string | undefined,
  options: { nativeFeatures?: boolean } = {}
): Promise<void> {
  const checkedNonce = z.string().uuid().parse(nonce)
  const directory = resolveBundledOctopodSlot()
  let artifactVersion: string
  try {
    artifactVersion = await readOctopodArtifactIdentity(directory)
  } catch (cause) {
    throw new OctopodBundledRuntimeError('The bundled Shield artifacts are incomplete or altered', {
      cause
    })
  }
  const result = await preflightProfileStateRuntime()
  // Host Node rollback launchers do not serve the bundled slot.
  if (isRunningAsBundledOctopodRuntime(directory)) {
    await preflightOctopodNativeRuntime(options)
  }
  const response: OctopodProfilePreflightResponse = {
    type: 'shield_profile_state_ready',
    nonce: checkedNonce,
    runtime: 'node',
    runtimeVersion: process.versions.node,
    artifactVersion,
    ...result
  }
  console.log(JSON.stringify(response))
}

async function readInstalledVersion(directory: string): Promise<string> {
  try {
    return octopodProfilePreflightResponseSchema.shape.artifactVersion.parse(
      (await readFile(join(directory, OCTOPOD_VERSION_FILENAME), 'utf8')).trim()
    )
  } catch (cause) {
    throw new OctopodBundledRuntimeError(
      'The installed Shield artifact version is missing or invalid',
      {
        cause
      }
    )
  }
}
