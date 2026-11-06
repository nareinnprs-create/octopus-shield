import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { arakanBundledLaunchCommand, resolveArakanSpawnCommand } from './arakan-bundled-binary'

const emptyDevRoots: string[] = []
afterEach(() => {
  for (const dir of emptyDevRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  delete process.env.OSHIELD_DEV_RESOURCES
})

describe('arakanBundledLaunchCommand', () => {
  it('passes through non-arakan agents and non-plain commands', () => {
    expect(arakanBundledLaunchCommand('codex', 'arakan')).toBeNull()
    expect(arakanBundledLaunchCommand('arakan', 'arakan --model x')).toBeNull()
    expect(arakanBundledLaunchCommand('arakan', '/custom/arakan')).toBeNull()
  })

  it('returns null when the dev resources root has no bundled binary', () => {
    const empty = mkdtempSync(join(tmpdir(), 'arakan-empty-'))
    emptyDevRoots.push(empty)
    process.env.OSHIELD_DEV_RESOURCES = empty
    expect(arakanBundledLaunchCommand('arakan', 'arakan')).toBeNull()
    expect(resolveArakanSpawnCommand('darwin', 'arm64', false)).toBeNull()
  })
})
