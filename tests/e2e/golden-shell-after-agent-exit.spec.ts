import { expect, test } from './helpers/shield-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  GOLDEN_STUB_EXIT_MARKER,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForRestoredTerminalInputReady } from './helpers/restored-terminal-input-readiness'
import {
  focusActiveTerminalInput,
  waitForActivePanePtyId,
  waitForTerminalOutput
} from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

// Split the marker so terminal input echo cannot impersonate successful shell execution.
function buildSplitMarkerEcho(prefix: string, suffix: string): { command: string; marker: string } {
  const command =
    process.platform === 'win32'
      ? `Write-Output ('${prefix}' + '${suffix}')`
      : `echo "${prefix}""${suffix}"`
  return { command, marker: `${prefix}${suffix}` }
}

test('opens a clean live shell after an agent exits', async ({ shieldPage }) => {
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await ensureTerminalVisible(shieldPage)
  await configureGoldenStubAgent(shieldPage)
  await launchGoldenStubAgentFromNewTab(shieldPage)

  await shieldPage.keyboard.type('exit')
  await shieldPage.keyboard.press('Enter')
  await waitForTerminalOutput(shieldPage, GOLDEN_STUB_EXIT_MARKER, 15_000)

  const tabsBeforeShell = await shieldPage.locator('[data-testid="sortable-tab"]').count()
  await shieldPage.getByRole('button', { name: 'New tab' }).click({ force: true })
  await shieldPage
    .getByRole('menuitem', { name: /New Terminal/i })
    .first()
    .click({ force: true })
  await expect(shieldPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
  const shellPtyId = await waitForActivePanePtyId(shieldPage)
  // A bound pane can precede transport readiness; wait or marker keystrokes may be dropped.
  expect(await waitForRestoredTerminalInputReady(shieldPage, shellPtyId)).toBe(true)

  const afterAgent = buildSplitMarkerEcho('after-', 'agent')
  await focusActiveTerminalInput(shieldPage)
  await shieldPage.keyboard.type(afterAgent.command)
  await shieldPage.keyboard.press('Enter')
  await waitForTerminalOutput(shieldPage, afterAgent.marker, 15_000)

  const afterShiftEnter = buildSplitMarkerEcho('after-shift-', 'enter')
  await shieldPage.keyboard.press('Shift+Enter')
  await shieldPage.keyboard.type(afterShiftEnter.command)
  await shieldPage.keyboard.press('Enter')
  await waitForTerminalOutput(shieldPage, afterShiftEnter.marker, 15_000)
  await expect(shieldPage.locator('[data-testid="sortable-tab"]')).toHaveCount(tabsBeforeShell + 1)
})
