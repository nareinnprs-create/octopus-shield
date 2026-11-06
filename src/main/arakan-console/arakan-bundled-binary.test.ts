import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/app' } }))

import { arakanBundledLaunchCommand, resolveArakanSpawnCommand } from './arakan-bundled-binary'

describe('arakanBundledLaunchCommand', () => {
  it('passes through non-arakan agents and non-plain commands', () => {
    expect(arakanBundledLaunchCommand('codex', 'arakan')).toBeNull()
    expect(arakanBundledLaunchCommand('arakan', 'arakan --model x')).toBeNull()
    expect(arakanBundledLaunchCommand('arakan', '/custom/arakan')).toBeNull()
  })

  it('returns null when no binary is bundled', () => {
    expect(arakanBundledLaunchCommand('arakan', 'arakan')).toBeNull()
    expect(resolveArakanSpawnCommand('darwin', 'arm64', false)).toBeNull()
  })
})
