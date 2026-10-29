import { test, expect } from './helpers/shield-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  focusActiveTerminalInput,
  getTerminalContent,
  waitForActivePanePtyId,
  waitForActiveTerminalManager
} from './helpers/terminal'

test('terminal search counts real matches and repeat find selects the query', async ({
  shieldPage
}, testInfo) => {
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await ensureTerminalVisible(shieldPage)
  await waitForActiveTerminalManager(shieldPage, 30_000)
  const ptyId = await waitForActivePanePtyId(shieldPage)
  for (let line = 0; line < 3; line++) {
    await execInTerminal(shieldPage, ptyId, 'echo shield-search-proof')
  }
  await expect
    .poll(
      async () =>
        (await getTerminalContent(shieldPage))
          .split(/\r?\n/)
          .filter((line) => line.trim() === 'shield-search-proof').length
    )
    .toBe(3)
  await focusActiveTerminalInput(shieldPage)
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await shieldPage.keyboard.press(`${modifier}+f`)
  const search = shieldPage.locator('[data-terminal-search-root]')
  const input = search.locator('input')
  await expect(input).toBeFocused()
  await search.getByTitle('Regex', { exact: true }).click()
  const query = '^shield-search-proof$'
  await input.fill(query)
  await expect(search).toContainText(/[1-3]\/3/)
  const initialCount = await search.innerText()
  await input.press('Enter')
  await expect.poll(() => search.innerText()).not.toBe(initialCount)
  await shieldPage.screenshot({ path: testInfo.outputPath('search-results.png') })
  await input.press('ArrowLeft')
  await shieldPage.keyboard.press(`${modifier}+f`)
  await expect(input).toBeFocused()
  await expect
    .poll(() =>
      input.evaluate((element) =>
        element instanceof HTMLInputElement
          ? { start: element.selectionStart, end: element.selectionEnd }
          : null
      )
    )
    .toEqual({ start: 0, end: query.length })
  await shieldPage.screenshot({ path: testInfo.outputPath('search-query-selected.png') })
  await input.fill('no-such-search-result-314159')
  await expect(search).toContainText('No results')
  await input.press('Escape')
  await expect(search).toBeHidden()
})
