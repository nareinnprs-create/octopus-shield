import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/shield-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const relativeFilePath =
  'packages/shield/src/renderer/src/components/navigation/worktree/secondary-nav/SecondaryNav.tsx'

test('new-tab file results prioritize the filename and reveal the full path on hover', async ({
  shieldPage,
  testRepoPath
}) => {
  const filePath = path.join(testRepoPath, ...relativeFilePath.split('/'))
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, 'export const SecondaryNav = true\n')

  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await ensureTerminalVisible(shieldPage)

  const newTab = shieldPage.getByRole('button', { name: 'New tab' })
  // Use untranslated aria-autocomplete because aria-controls appears only once results exist.
  const input = shieldPage.locator('input[role="combobox"][aria-autocomplete="list"]')
  const row = shieldPage.locator('[role="option"]').filter({ hasText: 'Open file' }).first()
  // Activate by keyboard to avoid animated-strip stability; reopen/refill until async file scanning produces a result.
  await expect(async () => {
    if ((await newTab.getAttribute('aria-expanded')) !== 'true') {
      await newTab.press('Space')
    }
    await expect(input).toBeVisible({ timeout: 1_000 })
    if ((await input.inputValue()) !== 'secondaryNav') {
      await input.fill('secondaryNav')
    }
    await expect(row).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await expect(row).toContainText('SecondaryNav.tsx')
  await expect(row).toContainText('packages/shield/src/renderer/src/components/navigation/')
  const rowText = await row.textContent()
  expect(rowText?.indexOf('SecondaryNav.tsx')).toBeLessThan(
    rowText?.indexOf('packages/shield/src/renderer/src/components/navigation/') ?? -1
  )

  // The filename must survive intact; only the directory may be clipped, and the
  // row itself must never spill past the dropdown.
  const overflow = await row.evaluate((element) => {
    const filename = element.querySelector(':scope > span:last-of-type > span:first-child')
    return {
      filenameClipped: filename ? filename.scrollWidth > filename.clientWidth : true,
      rowClipped: element.scrollWidth > element.clientWidth
    }
  })
  expect(overflow).toEqual({ filenameClipped: false, rowClipped: false })

  // Hover twice because streamed results can remount under a stationary pointer before Radix receives pointermove.
  await row.hover({ position: { x: 20, y: 12 } })
  await shieldPage.waitForTimeout(250)
  await row.hover({ position: { x: 40, y: 12 } })

  // Units pin exact cursor offsets; E2E proves the full-path tooltip opens without measuring mid-reflow geometry.
  await expect(
    shieldPage.locator('[data-slot="tooltip-content"]').filter({ hasText: relativeFilePath })
  ).toBeVisible()

  const proofPath = process.env.OSHIELD_STA3424_PROOF_PATH
  if (proofPath) {
    await shieldPage.screenshot({ path: proofPath })
  }
})
