// #10142: keyboard and X close must both confirm for the same live sleep 300 child, preserving the tab until approval.
import { test, expect } from './helpers/shield-app'
import type { Page } from '@stablyai/playwright-test'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveTabId,
  ensureTerminalVisible
} from './helpers/store'
import {
  execInTerminal,
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForPaneCount,
  waitForTerminalOutput
} from './helpers/terminal'

const SORTABLE_TAB = '[data-testid="sortable-tab"]'

function countRenderedTabs(page: Page): Promise<number> {
  return page.locator(SORTABLE_TAB).count()
}

function closeDialogTitle(page: Page) {
  return page.getByText(/Stop running command\?|Stop this agent\?/)
}

test.describe.configure({ mode: 'serial' })

test('the tab X button applies the same running-process confirmation as Cmd+W', async ({
  shieldPage
}) => {
  test.setTimeout(120_000)
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await ensureTerminalVisible(shieldPage)
  const hasPaneManager = await waitForActiveTerminalManager(shieldPage, 30_000)
    .then(() => true)
    .catch(() => false)
  test.skip(!hasPaneManager, 'Electron automation never mounted the live TerminalPane manager.')
  await waitForPaneCount(shieldPage, 1, 30_000)

  const ptyId = await waitForActivePanePtyId(shieldPage)
  await execInTerminal(shieldPage, ptyId, 'echo repro-10142-ready')
  await waitForTerminalOutput(shieldPage, 'repro-10142-ready', 20_000)
  await execInTerminal(shieldPage, ptyId, 'sleep 300')
  // Wait for sleep as foreground process; macOS login makes hasChildProcesses true before the command starts.
  await expect
    .poll(
      async () =>
        (await shieldPage.evaluate((id) => window.api.pty.inspectProcess(id), ptyId))
          .foregroundProcess,
      { timeout: 20_000, message: 'sleep 300 never became the foreground process' }
    )
    .toBe('sleep')

  const busyTabId = (await getActiveTabId(shieldPage))!
  const busyTab = shieldPage.locator(`${SORTABLE_TAB}[data-tab-id="${busyTabId}"]`).first()

  await focusActiveTerminalInput(shieldPage)
  await shieldPage.keyboard.press(process.platform === 'darwin' ? 'Meta+w' : 'Control+w')
  await expect(closeDialogTitle(shieldPage)).toBeVisible({ timeout: 15_000 })
  await shieldPage.getByRole('button', { name: /^Cancel$/ }).click()
  await expect(closeDialogTitle(shieldPage)).toBeHidden()
  await expect(busyTab).toBeVisible()
  const tabsBefore = await countRenderedTabs(shieldPage)

  await busyTab.hover()
  await busyTab.getByRole('button', { name: /^Close tab /i }).click()
  await shieldPage.waitForTimeout(1_500)

  expect(
    {
      confirmDialogVisible: await closeDialogTitle(shieldPage).isVisible(),
      tabStillPresent: (await countRenderedTabs(shieldPage)) === tabsBefore
    },
    'X-button close must apply the same running-process confirmation as Cmd+W'
  ).toEqual({ confirmDialogVisible: true, tabStillPresent: true })
})
