import { test, expect } from './helpers/shield-app'

test.use({ dismissOnboarding: false, seedTestRepo: false })

test('Retry recovers a rejected language catalog request without reloading', async ({
  electronApp,
  shieldPage
}, testInfo) => {
  await shieldPage.evaluate(async () => {
    const store = window.__store
    if (!store) {
      throw new Error('Renderer store unavailable')
    }
    const settings = await window.api.settings.get()
    if (!settings.telemetry) {
      throw new Error('Telemetry settings unavailable')
    }
    await store.getState().updateSettingsOrThrow({
      uiLanguage: 'en',
      telemetry: { ...settings.telemetry, onboardingLanguageCohort: 'treatment' }
    })
  })
  await shieldPage.getByRole('button', { name: 'Switch language' }).click()
  await expect(shieldPage.getByRole('radio', { name: '日本語', exact: true })).toBeVisible()

  await electronApp.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: /\/ja-[^/]+\.(?:json|js)(?:\?|$)/.test(details.url) })
    })
  })
  const timeOrigin = await shieldPage.evaluate(() => performance.timeOrigin)
  const rejected = shieldPage.waitForEvent('requestfailed', {
    predicate: (request) => /\/ja-[^/]+\.(?:json|js)(?:\?|$)/.test(request.url())
  })
  await shieldPage.getByRole('radio', { name: '日本語', exact: true }).click()
  const failedRequest = await rejected
  await expect(shieldPage.getByRole('alert')).toContainText('Could not load this language')
  await expect(shieldPage.getByRole('radio', { name: 'English', exact: true })).toBeChecked()
  await shieldPage.screenshot({ path: testInfo.outputPath('catalog-request-rejected.png') })

  await electronApp.evaluate(({ session }) => {
    session.defaultSession.webRequest.onBeforeRequest(null)
  })
  expect(
    await shieldPage.evaluate(async (url) => (await fetch(url)).status, failedRequest.url())
  ).toBe(200)
  await shieldPage.getByRole('button', { name: 'Retry', exact: true }).click()

  await expect(shieldPage.getByRole('radio', { name: '日本語', exact: true })).toBeChecked()
  await expect(shieldPage.getByRole('radiogroup', { name: '表示言語', exact: true })).toBeVisible()
  await expect(shieldPage.getByRole('alert')).toHaveCount(0)
  await expect
    .poll(() => shieldPage.evaluate(() => window.api.settings.get().then((s) => s.uiLanguage)))
    .toBe('ja')
  expect(await shieldPage.evaluate(() => performance.timeOrigin)).toBe(timeOrigin)
  await shieldPage.screenshot({ path: testInfo.outputPath('catalog-retry-recovered.png') })
})
