import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from './helpers/shield-app'

test('dense CSVs below 1 MiB remain visible and shrinking a later row window recovers', async ({
  shieldPage,
  seededRepoPath,
  electronApp
}, testInfo) => {
  const name = 'dense-small.csv'
  const filePath = path.join(seededRepoPath, name)
  writeFileSync(filePath, `id\n${'\n'.repeat(600_000)}`)
  await shieldPage.evaluate(
    ({ name, filePath }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing dense CSV workspace')
      }
      state.openFile(
        {
          filePath,
          relativePath: name,
          worktreeId: state.activeWorktreeId,
          language: 'plaintext',
          mode: 'edit'
        },
        { preview: false }
      )
    },
    { name, filePath }
  )
  await expect(shieldPage.getByTestId('csv-grid')).toHaveAttribute('aria-rowcount', '600001')
  await shieldPage.getByRole('button', { name: 'Next rows' }).click()
  await expect(shieldPage.getByRole('rowheader', { name: '500001', exact: true })).toBeVisible()
  await shieldPage.getByTestId('csv-scroll').evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(shieldPage.getByRole('rowheader', { name: '600000', exact: true })).toBeVisible()
  await shieldPage.evaluate(() => {
    const state = window.__store?.getState()
    const file = state?.openFiles.find((file) => file.filePath.endsWith('dense-small.csv'))
    if (!state || !file) {
      throw new Error('Missing dense CSV tab')
    }
    state.setEditorDraft(file.id, 'id\nfirst\nsecond\nthird\n')
  })
  await expect(shieldPage.getByTestId('csv-grid')).toHaveAttribute('aria-rowcount', '4')
  await expect(shieldPage.getByRole('gridcell', { name: 'first', exact: true })).toBeVisible()
  await expect(shieldPage.getByRole('gridcell', { name: 'third', exact: true })).toBeVisible()
  await expect(shieldPage.getByRole('button', { name: 'Next rows' })).toHaveCount(0)
  await shieldPage.screenshot({ path: testInfo.outputPath('dense-after-shrink.png') })
  if (
    process.env.OSHIELD_E2E_FORCE_HEADFUL !== '1' &&
    testInfo.project.metadata.shieldHeadful !== true
  ) {
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  }
})

test('CSV links navigate from small and paged previews without replacing the renderer', async ({
  shieldPage,
  seededRepoPath,
  electronApp
}, testInfo) => {
  test.setTimeout(90_000)
  const url = 'https://example.com/?from=csv#demo'
  const smallName = 'csv-links.csv'
  const largeName = 'csv-links-large.csv'
  const content = `name,url,notes\nExample,${url},javascript:alert(1)\n`
  writeFileSync(path.join(seededRepoPath, smallName), content)
  writeFileSync(
    path.join(seededRepoPath, largeName),
    content + `Record,${url},${'x'.repeat(200)}\n`.repeat(6000)
  )
  await shieldPage.evaluate(async () => {
    await window.__store?.getState().updateSettings({ openLinksInApp: true })
  })
  for (const name of [smallName, largeName]) {
    await shieldPage.evaluate(
      ({ name, filePath }) => {
        const state = window.__store?.getState()
        if (!state?.activeWorktreeId) {
          throw new Error('Missing CSV test workspace')
        }
        state.openFile(
          {
            filePath,
            relativePath: name,
            worktreeId: state.activeWorktreeId,
            language: 'plaintext',
            mode: 'edit'
          },
          { preview: false }
        )
      },
      { name, filePath: path.join(seededRepoPath, name) }
    )
    const link = shieldPage.getByTestId('csv-grid').getByRole('link', { name: url }).first()
    await expect(link).toBeVisible({ timeout: 30_000 })
    await expect(link).toHaveAttribute('href', url)
    await expect(
      shieldPage
        .getByTestId('csv-grid')
        .locator('[data-csv-column="2"]')
        .filter({ hasText: 'javascript:alert(1)' })
        .first()
    ).toBeVisible()
    await shieldPage.screenshot({ path: testInfo.outputPath(`${name}.png`) })
    const rendererUrl = shieldPage.url()
    const tabsBefore = await shieldPage.evaluate(
      () => Object.values(window.__store?.getState().browserTabsByWorktree ?? {}).flat().length
    )
    if (name === largeName) {
      await link.focus()
      await shieldPage.keyboard.press('Enter')
    } else {
      await link.click()
    }
    await expect
      .poll(() =>
        shieldPage.evaluate(
          () => Object.values(window.__store?.getState().browserTabsByWorktree ?? {}).flat().length
        )
      )
      .toBe(tabsBefore + 1)
    expect(
      await shieldPage.evaluate(
        () =>
          Object.values(window.__store?.getState().browserTabsByWorktree ?? {})
            .flat()
            .at(-1)?.url
      )
    ).toBe(url)
    expect(shieldPage.url()).toBe(rendererUrl)
  }
  if (
    process.env.OSHIELD_E2E_FORCE_HEADFUL !== '1' &&
    testInfo.project.metadata.shieldHeadful !== true
  ) {
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((window) => window.isVisible())
      )
    ).toBe(false)
  }
})
