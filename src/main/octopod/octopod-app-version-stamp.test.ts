import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stampOctopodAppVersion } from './octopod-host-adapters'

describe('the Shield version a server reports', () => {
  let root: string
  let saved: string | undefined

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'octopod-app-version-'))
    saved = process.env.OSHIELD_APP_VERSION
    delete process.env.OSHIELD_APP_VERSION
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
    if (saved === undefined) {
      delete process.env.OSHIELD_APP_VERSION
    } else {
      process.env.OSHIELD_APP_VERSION = saved
    }
  })

  it('replaces a version inherited from the Shield that started it', () => {
    process.env.OSHIELD_APP_VERSION = '1.4.300'
    mkdirSync(join(root, 'out'), { recursive: true })
    writeFileSync(join(root, 'out', 'package.json'), JSON.stringify({ version: '1.4.224' }))
    stampOctopodAppVersion(() => root)
    expect(process.env.OSHIELD_APP_VERSION).toBe('1.4.224')
  })

  it('leaves the environment alone when the bundle has no version', () => {
    stampOctopodAppVersion(() => root)
    expect(process.env.OSHIELD_APP_VERSION).toBeUndefined()
    stampOctopodAppVersion(() => {
      throw new Error('octopod_install_root_unavailable')
    })
    expect(process.env.OSHIELD_APP_VERSION).toBeUndefined()
  })
})
