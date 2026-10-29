import { expect, test } from './helpers/shield-app'
import { openFileExplorer } from './helpers/file-explorer'
import { pressShortcut } from './helpers/shortcuts'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test('Explorer-opened Markdown accepts the find shortcut without a document click', async ({
  shieldPage
}) => {
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await openFileExplorer(shieldPage)

  const readmeRow = shieldPage.locator('[data-file-explorer-row]').filter({ hasText: 'README.md' })
  await expect(readmeRow).toBeVisible({ timeout: 10_000 })
  await readmeRow.focus()
  await readmeRow.click()

  await expect(shieldPage.locator('.rich-markdown-editor')).toBeVisible({ timeout: 25_000 })
  await pressShortcut(shieldPage, 'f')

  await expect(
    shieldPage.getByRole('textbox', { name: 'Find in rich markdown editor' })
  ).toBeVisible()
})
