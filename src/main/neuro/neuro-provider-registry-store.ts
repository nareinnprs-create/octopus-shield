import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { writeSecureFile } from '../../shared/secure-file'
import {
  sanitizeNeuroProviderProfile,
  sanitizeNeuroProviderRegistryFile,
  type NeuroProviderFetchLike
} from './neuro-provider-registry'
import type {
  NeuroProviderProfile,
  NeuroProviderRegistryFile
} from '../../shared/neuro-provider-types'

export type NeuroProviderRegistryStore = {
  filePath: () => string
  list: () => NeuroProviderProfile[]
  get: (id: string) => NeuroProviderProfile | null
  upsert: (profile: NeuroProviderProfile) => NeuroProviderProfile[]
  remove: (id: string) => NeuroProviderProfile[]
}

/**
 * Profile JSON holds no secrets — keys live in per-profile encrypted
 * envelopes — but it is still written with restricted permissions.
 */
export function createNeuroProviderRegistryStore(filePath: string): NeuroProviderRegistryStore {
  let cached: NeuroProviderRegistryFile | null = null

  function load(): NeuroProviderRegistryFile {
    if (cached !== null) {
      return cached
    }
    cached = existsSync(filePath)
      ? sanitizeNeuroProviderRegistryFile(parseJsonFile(filePath))
      : { version: 1, profiles: [] }
    return cached
  }

  function persist(): NeuroProviderProfile[] {
    const file = load()
    mkdirSync(dirname(filePath), { recursive: true })
    writeSecureFile(filePath, JSON.stringify(file, null, 2), { durable: true })
    return file.profiles
  }

  return {
    filePath: () => filePath,
    list: () => load().profiles,
    get: (id) => load().profiles.find((profile) => profile.id === id) ?? null,
    upsert: (profile) => {
      const file = load()
      const sanitized = sanitizeNeuroProviderProfile(profile)
      if (sanitized === null) {
        throw new Error('Neuro provider profile is invalid')
      }
      const existingIndex = file.profiles.findIndex((entry) => entry.id === sanitized.id)
      if (existingIndex === -1) {
        file.profiles.push(sanitized)
      } else {
        file.profiles[existingIndex] = sanitized
      }
      return persist()
    },
    remove: (id) => {
      const file = load()
      file.profiles = file.profiles.filter((profile) => profile.id !== id)
      return persist()
    }
  }
}

function parseJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

export type { NeuroProviderFetchLike }
