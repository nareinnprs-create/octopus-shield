// A fresh profile may have no automation history; Runs navigation and its empty state must still work.

import { test, expect } from './helpers/shield-app'
import { waitForSessionReady } from './helpers/store'

test('opens the runs dashboard and returns to automations', async ({ shieldPage }) => {
  await waitForSessionReady(shieldPage)

  await shieldPage.evaluate(() => {
    const store = window.__store
    if (!store) {
      throw new Error('window.__store is not available')
    }
    store.getState().openAutomationsPage()
  })

  const runsButton = shieldPage.getByRole('button', { name: 'Runs' })
  await expect(runsButton).toBeVisible()
  await runsButton.click()

  await expect(shieldPage.getByRole('navigation', { name: 'Automations breadcrumb' })).toBeVisible()
  await expect(shieldPage.getByText('Successful · 24h')).toBeVisible()
  await expect(shieldPage.getByText('Failed · 24h')).toBeVisible()
  await expect(shieldPage.getByText('Successful · 7d')).toBeVisible()
  await expect(shieldPage.getByText('Failed · 7d')).toBeVisible()
  await expect(shieldPage.getByRole('button', { name: 'Filters' })).toBeVisible()
  await expect(shieldPage.getByRole('button', { name: 'Refresh runs' })).toBeVisible()
  await expect(shieldPage.getByText('Automation', { exact: true })).toBeVisible()
  await expect(shieldPage.getByText('Triggered', { exact: true })).toBeVisible()
  await expect(shieldPage.getByText('Status', { exact: true })).toBeVisible()

  await shieldPage
    .getByRole('navigation', { name: 'Automations breadcrumb' })
    .getByRole('button', { name: 'Automations' })
    .click()
  await expect(shieldPage.getByRole('heading', { name: 'Automations' })).toBeVisible()
  await expect(runsButton).toBeVisible()
})
