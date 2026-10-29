import { test, expect } from './helpers/shield-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { showActivePaneAsNativeChat } from './helpers/native-chat-view'
import { waitForActiveTerminalManager } from './helpers/terminal'

test('typing @ in the chat composer lists workspace files and inserts the chosen one', async ({
  shieldPage
}, testInfo) => {
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await ensureTerminalVisible(shieldPage)
  await waitForActiveTerminalManager(shieldPage)
  await showActivePaneAsNativeChat(shieldPage, 'claude', 'Claude')

  const composer = shieldPage.getByRole('textbox', {
    name: 'Ask anything, @ to mention files, / for commands',
    exact: true
  })
  await expect(composer).toBeVisible()
  await composer.click()

  await shieldPage.keyboard.type('review @')
  // The sidebar's worktree list is a listbox too.
  const files = shieldPage.locator('[role="listbox"][id^="native-chat-picker-"]')
  await expect(files.getByRole('option', { name: /README\.md/ })).toBeVisible()
  await shieldPage.screenshot({ path: testInfo.outputPath('mention-all-files.png') })

  await shieldPage.keyboard.type('index')
  const match = files.getByRole('option', { name: /index\.ts/ })
  await expect(match).toHaveAttribute('aria-selected', 'true')
  await expect(files.getByRole('option', { name: /README\.md/ })).toHaveCount(0)
  await shieldPage.screenshot({ path: testInfo.outputPath('mention-filtered.png') })

  await shieldPage.keyboard.press('Enter')
  await expect(composer).toHaveText('review @src/index.ts ')
  await expect(files).toHaveCount(0)

  await shieldPage.keyboard.type('@zzz-no-such-file')
  await expect(files).toContainText('No matching files')
  // A one-off app tooltip can be open and takes the first Escape for itself.
  await expect(async () => {
    await shieldPage.keyboard.press('Escape')
    await expect(files).toHaveCount(0, { timeout: 1000 })
  }).toPass()
  await shieldPage.keyboard.type('x')
  await expect(composer).toContainText('@zzz-no-such-filex')
  await expect(files).toHaveCount(0)
  await shieldPage.keyboard.type(' @')
  await expect(files.getByRole('option', { name: /README\.md/ })).toBeVisible()
})
