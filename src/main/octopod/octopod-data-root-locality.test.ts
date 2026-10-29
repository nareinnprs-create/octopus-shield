import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { octopodDataRootIsOnLocalDisk } from './octopod-data-root-locality'

describe('octopodDataRootIsOnLocalDisk', () => {
  it.runIf(process.platform === 'linux' || process.platform === 'darwin')(
    'recognises a local temp directory, and refuses a path it cannot inspect',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'octopod-locality-'))
      try {
        expect(octopodDataRootIsOnLocalDisk(root)).toBe(true)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
      expect(octopodDataRootIsOnLocalDisk(join(root, 'missing'))).toBe(false)
    }
  )

  it('treats a Windows UNC data root as reachable from other machines', () => {
    expect(octopodDataRootIsOnLocalDisk('\\\\filer\\home\\shield', 'win32')).toBe(false)
    expect(octopodDataRootIsOnLocalDisk('\\\\?\\UNC\\filer\\home\\shield', 'win32')).toBe(false)
    expect(octopodDataRootIsOnLocalDisk('C:\\Users\\u\\AppData\\Roaming\\shield', 'win32')).toBe(true)
    expect(octopodDataRootIsOnLocalDisk('\\\\?\\C:\\Users\\u\\shield', 'win32')).toBe(true)
  })
})
