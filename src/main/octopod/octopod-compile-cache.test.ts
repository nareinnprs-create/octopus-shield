import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../shared/octopod-managed-launch-env'
import {
  OCTOPOD_COMPILE_CACHE_DIRNAME,
  enableManagedOctopodCompileCache,
  octopodCompileCacheEnv
} from './octopod-compile-cache'

const managed = {
  [OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV]: '/home/u/.shield-remote/.fence'
}

describe('managed octopod compile cache', () => {
  it('never writes into a slot no client manages, such as a packaged app', () => {
    const enableCompileCache = vi.fn()
    enableManagedOctopodCompileCache('/Applications/Shield.app/octopod', {}, { enableCompileCache })
    expect(enableCompileCache).not.toHaveBeenCalled()
  })

  it('starts as before on a runtime without the API or with an unwritable slot', () => {
    expect(() => enableManagedOctopodCompileCache('/slot', managed, {})).not.toThrow()
    const enableCompileCache = vi.fn(() => {
      throw new Error('EACCES')
    })
    expect(() =>
      enableManagedOctopodCompileCache('/slot', managed, { enableCompileCache })
    ).not.toThrow()
  })

  it('hands the preflight child the slot cache only when this process enabled one', () => {
    const enabled = { getCompileCacheDir: () => '/slot/x/v24' }
    expect(octopodCompileCacheEnv('/slot', enabled, managed)).toEqual({
      NODE_COMPILE_CACHE: join('/slot', OCTOPOD_COMPILE_CACHE_DIRNAME)
    })
    expect(octopodCompileCacheEnv('/slot', { getCompileCacheDir: () => undefined }, managed)).toEqual(
      {}
    )
    expect(octopodCompileCacheEnv('/slot', {}, managed)).toEqual({})
    expect(octopodCompileCacheEnv('/slot', enabled, {})).toEqual({})
  })
})
