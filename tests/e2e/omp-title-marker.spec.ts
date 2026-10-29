import { writeFile } from 'node:fs/promises'
import { buildShellCommandFromArgv } from '../../src/shared/tui-agent-startup-shell'
import { test, expect } from './helpers/shield-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

test('OMP spaced-colon title renders working and clears on idle', async ({
  shieldPage
}, testInfo) => {
  test.skip(
    process.platform === 'win32',
    'POSIX title replay; Windows formatter bytes have separate coverage'
  )
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await ensureTerminalVisible(shieldPage)
  await waitForActiveTerminalManager(shieldPage)
  const ptyId = await waitForActivePanePtyId(shieldPage)
  const script = testInfo.outputPath('title-replay.cjs')
  await writeFile(
    script,
    `
process.stdout.write('\\x1b]0;OMP : Image review\\x07')
process.stdin.on('data', () => process.stdout.write('\\x1b]0;OMP > Image review\\x07'))
`
  )
  await execInTerminal(
    shieldPage,
    ptyId,
    buildShellCommandFromArgv([process.execPath, script], 'posix')
  )
  const working = shieldPage.locator('[aria-label="Working"]')
  await expect(working.first()).toBeVisible({ timeout: 15000 })
  await shieldPage.screenshot({ path: testInfo.outputPath('omp-title-working.png') })
  await sendToTerminal(shieldPage, ptyId, '\r')
  await expect(working).toHaveCount(0)
  await shieldPage.screenshot({ path: testInfo.outputPath('omp-title-idle.png') })
})
