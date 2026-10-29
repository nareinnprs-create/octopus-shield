import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readOctopodHostAccountLaunchEnv } from './octopod-host-account-launch-env-store'

const dirs: string[] = []
function userData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'octopod-host-accounts-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('octopod host account launch env store', () => {
  it('reads nothing from a missing, corrupt or unsafe file', () => {
    const dir = userData()
    expect(readOctopodHostAccountLaunchEnv(dir)).toBeNull()
    writeFileSync(join(dir, 'host-account-launch-env.json'), '{not json')
    expect(readOctopodHostAccountLaunchEnv(dir)).toBeNull()
    writeFileSync(
      join(dir, 'host-account-launch-env.json'),
      JSON.stringify({ wslDistro: 'Ubuntu', claude: { PATH: '/evil' }, terminal: {} })
    )
    expect(readOctopodHostAccountLaunchEnv(dir)).toBeNull()
  })
})
