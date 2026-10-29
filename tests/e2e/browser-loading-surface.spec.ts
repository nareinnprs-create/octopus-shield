import { expect, test } from './helpers/shield-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { crashGuestRenderer } from './browser-guest-runtime-oracle'
import { observeBrowserLoadingSurface } from './browser-loading-surface-oracle'

test('browser host follows the theme before content and preserves the webpage canvas', async ({
  shieldPage,
  electronApp
}, testInfo) => {
  await waitForSessionReady(shieldPage)
  await ensureTerminalVisible(shieldPage)
  await waitForActiveWorktree(shieldPage)
  const observations = await observeBrowserLoadingSurface(
    shieldPage,
    (name) => testInfo.outputPath(name),
    async (id) => {
      await crashGuestRenderer(electronApp, id)
    }
  )
  expect(observations.filter((entry) => !entry.pass)).toEqual([])
})
