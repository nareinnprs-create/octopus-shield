import { createEncryptedApiKeyFileStore } from '../credentials/encrypted-api-key-file-store'
import { neuroProviderAuthRefFor } from '../../shared/neuro-provider-types'

const stores = new Map<string, ReturnType<typeof createEncryptedApiKeyFileStore>>()

function keyFileName(id: string): string {
  return `${neuroProviderAuthRefFor(id)}.enc`
}

/** One encrypted envelope per provider profile under `~/.shield/`. */
export function getNeuroProviderKeyStore(
  id: string
): ReturnType<typeof createEncryptedApiKeyFileStore> {
  const authRef = neuroProviderAuthRefFor(id)
  let store = stores.get(authRef)
  if (store === undefined) {
    store = createEncryptedApiKeyFileStore({
      fileName: keyFileName(id),
      envelopePrefix: `shield-neuro-api-key:v1:${id}:`,
      providerLabel: `Neuro provider "${id}"`,
      logScope: `neuro:${id}`
    })
    stores.set(authRef, store)
  }
  return store
}

export function neuroProviderKeyEnvelopePath(id: string): { path: string; envelopePrefix: string } {
  const { path, envelopePrefix } = getNeuroProviderKeyStore(id).envelopeFile()
  return { path, envelopePrefix }
}
