import { test, expect } from './helpers/shield-app'
import { getStoreState, waitForSessionReady } from './helpers/store'

test.describe('usage overview', () => {
  test.beforeEach(async ({ shieldPage }) => {
    await waitForSessionReady(shieldPage)
  })

  test('Stats & Usage opens on the combined overview with provider controls', async ({
    shieldPage
  }) => {
    await shieldPage.evaluate(() => {
      const state = window.__store!.getState()
      state.openSettingsPage()
    })

    await expect
      .poll(async () => getStoreState<string>(shieldPage, 'activeView'), { timeout: 5_000 })
      .toBe('settings')
    await shieldPage.getByRole('button', { name: 'Stats & Usage' }).click()
    await expect(shieldPage.getByRole('heading', { name: 'Usage Analytics' })).toBeVisible()
    const providerDropdown = shieldPage.getByTestId('usage-provider-select')
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: Overview'
    )
    await expect(shieldPage.getByTestId('usage-overview-pane')).toBeVisible()
    await expect(shieldPage.getByRole('heading', { name: 'Usage Overview' })).toBeVisible()
    await expect(shieldPage.getByRole('heading', { name: 'Providers' })).toBeVisible()
    await expect(shieldPage.getByRole('button', { name: 'Enable Claude' })).toBeVisible()
    await expect(shieldPage.getByRole('button', { name: 'Enable Codex' })).toBeVisible()
    await expect(shieldPage.getByRole('button', { name: 'Enable OpenCode' })).toBeVisible()

    await providerDropdown.click()
    await shieldPage.getByRole('menuitem', { name: 'Codex', exact: true }).click()
    await expect(shieldPage.getByRole('heading', { name: 'Codex Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute('aria-label', 'Usage analytics provider: Codex')

    await providerDropdown.click()
    await shieldPage.getByRole('menuitem', { name: 'OpenCode', exact: true }).click()
    await expect(shieldPage.getByRole('heading', { name: 'OpenCode Usage Tracking' })).toBeVisible()
    await expect(providerDropdown).toHaveAttribute(
      'aria-label',
      'Usage analytics provider: OpenCode'
    )
  })
})
