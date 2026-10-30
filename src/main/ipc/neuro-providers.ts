import { app, ipcMain } from 'electron'
import { join } from 'node:path'
import type { NeuroProviderProfile, NeuroProviderStatus } from '../../shared/neuro-provider-types'
import { neuroProviderAuthRefFor } from '../../shared/neuro-provider-types'
import {
  sanitizeNeuroProviderProfile,
  testNeuroProviderConnection
} from '../neuro/neuro-provider-registry'
import { createNeuroProviderRegistryStore } from '../neuro/neuro-provider-registry-store'
import { getNeuroProviderKeyStore } from '../neuro/neuro-provider-key-store'

let store: ReturnType<typeof createNeuroProviderRegistryStore> | null = null

function registry(): ReturnType<typeof createNeuroProviderRegistryStore> {
  if (store === null) {
    store = createNeuroProviderRegistryStore(join(app.getPath('userData'), 'neuro-providers.json'))
  }
  return store
}

/**
 * authRef is vault-internal and always derived from the profile id here;
 * IPC callers never choose which envelope a key lands in.
 */
function adoptProfile(input: unknown): NeuroProviderProfile {
  const profile = sanitizeNeuroProviderProfile(input)
  if (profile === null) {
    throw new Error('Neuro provider profile is invalid')
  }
  return {
    ...profile,
    authRef: profile.authScheme === 'none' ? null : neuroProviderAuthRefFor(profile.id)
  }
}

function getStatus(): NeuroProviderStatus {
  const profiles = registry().list()
  const keyConfigured: Record<string, boolean> = {}
  const keyProtection: NeuroProviderStatus['keyProtection'] = {}
  for (const profile of profiles) {
    if (profile.authScheme === 'none' || profile.authRef === null) {
      keyConfigured[profile.id] = true
      keyProtection[profile.id] = null
      continue
    }
    const keyStore = getNeuroProviderKeyStore(profile.id)
    keyConfigured[profile.id] = keyStore.has()
    keyProtection[profile.id] = keyConfigured[profile.id] ? keyStore.protection() : null
  }
  return { profiles, keyConfigured, keyProtection }
}

function saveProfile(input: unknown): NeuroProviderStatus {
  registry().upsert(adoptProfile(input))
  return getStatus()
}

function removeProfile(id: unknown): NeuroProviderStatus {
  if (typeof id !== 'string') {
    throw new Error('Neuro provider id must be a string')
  }
  registry().remove(id)
  try {
    getNeuroProviderKeyStore(id).clear()
  } catch (error) {
    console.warn(`[neuro:${id}] failed to clear key envelope while removing profile:`, error)
  }
  return getStatus()
}

function saveKey(id: unknown, key: unknown): NeuroProviderStatus {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('Neuro provider API key must be a non-empty string')
  }
  const profile = registry().get(requireProfileId(id))
  if (profile === null) {
    throw new Error('Neuro provider profile not found')
  }
  if (profile.authScheme === 'none') {
    throw new Error('This provider does not use an API key')
  }
  getNeuroProviderKeyStore(profile.id).save(key)
  return getStatus()
}

function clearKey(id: unknown): NeuroProviderStatus {
  getNeuroProviderKeyStore(requireProfileId(id)).clear()
  return getStatus()
}

async function testProfile(input: { profile?: unknown; key?: unknown } | undefined) {
  const profile = adoptProfile(input?.profile)
  const draftKey = typeof input?.key === 'string' && input.key.length > 0 ? input.key : null
  return testNeuroProviderConnection(profile, {
    fetchLike: (url, init) => fetch(url, init),
    readKey: () => {
      if (draftKey !== null) {
        return draftKey
      }
      if (profile.authRef === null) {
        return null
      }
      return getNeuroProviderKeyStore(profile.id).read()
    }
  })
}

function requireProfileId(id: unknown): string {
  if (typeof id !== 'string') {
    throw new Error('Neuro provider id must be a string')
  }
  return id
}

export function registerNeuroProviderHandlers(): void {
  ipcMain.handle('neuroProviders:list', () => getStatus())
  ipcMain.handle('neuroProviders:save', (_event, profile: unknown) => saveProfile(profile))
  ipcMain.handle('neuroProviders:remove', (_event, id: unknown) => removeProfile(id))
  ipcMain.handle('neuroProviders:saveApiKey', (_event, id: unknown, key: unknown) =>
    saveKey(id, key)
  )
  ipcMain.handle('neuroProviders:clearApiKey', (_event, id: unknown) => clearKey(id))
  ipcMain.handle('neuroProviders:test', (_event, input) => testProfile(input))
}

/** Test seam: point the registry at a scratch file before first use. */
export function setNeuroProviderRegistryFilePathForTest(filePath: string): void {
  store = createNeuroProviderRegistryStore(filePath)
}

export function resetNeuroProviderRegistryForTest(): void {
  store = null
}
