// Always report available to prevent plaintext fallback; throw on seal/unseal when the key is unavailable.
import type { SecretStore } from '../../shared/secret-store'
import { sweepStaleRecordStaging } from './octopod-secret-key-record'
import {
  octopodSecretStatePath,
  resolveState,
  type OctopodSecretStorePrepareOptions,
  type StoreState
} from './octopod-secret-key-resolution'
import { openOctopodSecret, sealOctopodSecret } from './octopod-secret-sealing'

export type OctopodSecretStore = SecretStore & {
  prepare(options: OctopodSecretStorePrepareOptions): Promise<boolean>
}

export function createOctopodSecretStore(
  log: (message: string) => void = (message) => console.warn(message)
): OctopodSecretStore {
  let state: StoreState = { kind: 'pending' }
  const readyKey = (): Buffer => {
    if (state.kind === 'ready') {
      return state.key
    }
    throw new Error(
      state.kind === 'unavailable'
        ? state.message
        : 'octopod_secret_store_not_prepared — the headless secret store has not loaded its key yet'
    )
  }
  return {
    isEncryptionAvailable: () => state.kind !== 'plaintext',
    encryptString: (plainText) => sealOctopodSecret(readyKey(), plainText),
    decryptString: (cipher) => openOctopodSecret(readyKey(), cipher),
    describeProtectionGap: () => {
      switch (state.kind) {
        case 'ready':
          return state.gap
        case 'unavailable':
          return state.message
        case 'plaintext':
          return state.reason
        case 'pending':
          return "Shield's headless server has not loaded its credential key yet."
      }
    },
    async prepare(next) {
      sweepStaleRecordStaging(octopodSecretStatePath(next))
      state = await resolveState(next, log)
      return state.kind === 'ready'
    }
  }
}
