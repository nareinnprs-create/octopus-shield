import { expect, test } from './helpers/shield-app'
import {
  configureGoldenStubAgent,
  getGoldenStubAgentLaunchEnv,
  launchGoldenStubAgentFromNewTab
} from './helpers/golden-stub-agent'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { focusActiveTerminalInput, getTerminalContent } from './helpers/terminal'

test.use({ launchEnv: getGoldenStubAgentLaunchEnv() })

test('launches an agent TUI with a live multiline composer', async ({ shieldPage }) => {
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await ensureTerminalVisible(shieldPage)
  await configureGoldenStubAgent(shieldPage)
  await launchGoldenStubAgentFromNewTab(shieldPage)

  const activeTab = shieldPage.locator('[data-testid="sortable-tab"][data-active="true"]')
  await expect(activeTab).toHaveAttribute('data-tab-title', /Codex|Golden Stub Agent/i)

  await focusActiveTerminalInput(shieldPage)
  await shieldPage.keyboard.type('hello from e2e')
  await shieldPage.keyboard.press('Shift+Enter')
  await shieldPage.keyboard.type('second line')

  await expect
    .poll(() => getTerminalContent(shieldPage), { timeout: 10_000 })
    .toContain('> hello from e2e\r\n  second line')
  expect(await getTerminalContent(shieldPage)).not.toContain('GOLDEN_STUB_AGENT_SUBMITTED')
})
