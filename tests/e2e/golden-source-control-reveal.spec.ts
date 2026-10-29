import path from 'node:path'
import { test, expect } from './helpers/shield-app'
import {
  cleanupGoldenWorktree,
  createGoldenWorktree,
  GOLDEN_CHANGED_PATH,
  openGoldenSourceControl,
  seedGoldenSourceEdit
} from './helpers/golden-source-control'
import { waitForSessionReady } from './helpers/store'

// Keep separate from the open-diff golden that release-cut restores onto tags predating this menu item (#24502).
test('@golden offers to reveal a changed file in the OS file manager from its Source Control row', async ({
  shieldPage,
  testRepoPath,
  registerPostElectronShutdownCleanup
}) => {
  const fixture = createGoldenWorktree(testRepoPath, 'reveal-row')
  registerPostElectronShutdownCleanup(async () => cleanupGoldenWorktree(testRepoPath, fixture))
  seedGoldenSourceEdit(fixture.worktreePath)

  await waitForSessionReady(shieldPage)
  await openGoldenSourceControl(shieldPage, testRepoPath, fixture)

  const changedFile = shieldPage
    .locator('[data-testid="source-control-entry"]')
    .filter({ hasText: path.basename(GOLDEN_CHANGED_PATH) })
  await expect(changedFile).toBeVisible({ timeout: 15_000 })
  await changedFile.click({ button: 'right' })

  await expect(
    shieldPage.getByRole('menuitem', {
      name: /Reveal in Finder|Reveal in File Explorer|Open Containing Folder/
    })
  ).toBeEnabled()
})
