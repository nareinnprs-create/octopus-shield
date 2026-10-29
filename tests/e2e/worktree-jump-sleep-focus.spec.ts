import { test, expect } from './helpers/shield-app'
import {
  ensureTerminalVisible,
  getAllWorktreeIds,
  switchToWorktree,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import {
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'

test('Cmd+J focuses the terminal after waking a sleeping workspace', async ({
  shieldPage
}, testInfo) => {
  await waitForSessionReady(shieldPage)
  const source = await waitForActiveWorktree(shieldPage)
  const target = (await getAllWorktreeIds(shieldPage)).find((id) => id !== source)
  if (!target) {
    throw new Error('Expected a second seeded workspace')
  }
  await switchToWorktree(shieldPage, target)
  await ensureTerminalVisible(shieldPage)
  await waitForActiveTerminalManager(shieldPage)
  await waitForActivePanePtyId(shieldPage)
  const targetName = await shieldPage.evaluate((id) => {
    const state = window.__store!.getState()
    const worktree = state.getKnownWorktreeById(id)
    if (!worktree) {
      throw new Error('Missing target workspace')
    }
    return worktree.branch.replace(/^refs\/heads\//, '')
  }, target)
  await switchToWorktree(shieldPage, source)
  await shieldPage.evaluate(async (id) => {
    await window.__store!.getState().shutdownWorktreeTerminals(id, { keepIdentifiers: true })
  }, target)
  await shieldPage.evaluate(() => {
    const listSessions = window.api.pty.listSessions
    window.api.pty.listSessions = async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return listSessions(...args)
    }
  })
  // Native menu accelerators require OS focus; open the same palette in the hidden renderer.
  await shieldPage.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
  const dialog = shieldPage.getByRole('dialog', { name: 'Jump to...' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('combobox').fill(targetName)
  await expect(dialog.locator('[cmdk-item][data-selected="true"]')).toContainText(targetName)
  const cdp = await shieldPage.context().newCDPSession(shieldPage)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 8 })
  await shieldPage.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await waitForActiveTerminalManager(shieldPage)
  await waitForActivePanePtyId(shieldPage)
  const terminal = shieldPage.locator('[data-terminal-tab-id]:visible .xterm-helper-textarea').first()
  await shieldPage.screenshot({ path: testInfo.outputPath('wake-focus.png') })
  await expect(terminal).toBeFocused()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await cdp.detach()
  await shieldPage.keyboard.type('echo WAKE_KEYBOARD_OK')
  await shieldPage.keyboard.press('Enter')
  await waitForTerminalOutput(shieldPage, 'WAKE_KEYBOARD_OK')
  await shieldPage.screenshot({ path: testInfo.outputPath('wake-typing.png') })
})
