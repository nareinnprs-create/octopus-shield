import { test, expect } from './helpers/shield-app'
import { waitForSessionReady } from './helpers/store'

test.describe('Settings sidebar search on the Shortcuts pane', () => {
  test('pane-title-only query keeps rows visible and local search usable', async ({ shieldPage }) => {
    await waitForSessionReady(shieldPage)

    await shieldPage.evaluate(async () => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      // Pin English instead of following the host locale.
      await store.getState().updateSettings({ uiLanguage: 'en' })
      store.getState().openSettingsPage()
    })

    const searchInput = shieldPage.getByPlaceholder('Search settings')
    await expect(searchInput).toBeVisible()
    await expect(searchInput).toBeFocused()
    await searchInput.fill('shortcuts')

    await expect(shieldPage.getByRole('heading', { name: 'Shortcuts', exact: true })).toBeVisible()

    // Regression: a pane-title-only query used to blank the whole list (0/112).
    await expect(shieldPage.getByText('Go to File', { exact: true })).toBeVisible()
    await expect(shieldPage.getByText('No shortcuts match those filters.')).not.toBeVisible()

    // Keep pane search working with a global query; the old empty base list broke their intersection.
    const localSearch = shieldPage.getByPlaceholder('Search command or keys')
    await localSearch.fill('go to')
    await expect(shieldPage.getByText('Go to File', { exact: true })).toBeVisible()
    await expect(shieldPage.getByText('Force Reload', { exact: true })).not.toBeVisible()

    await localSearch.clear()
    await searchInput.fill('worktree')
    await expect(shieldPage.getByText('Create worktree', { exact: true })).toBeVisible()
    await expect(shieldPage.getByText('Go to File', { exact: true })).not.toBeVisible()
  })
})
