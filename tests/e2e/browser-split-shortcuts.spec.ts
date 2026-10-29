import { expect, test } from './helpers/shield-app'
import type { Page } from '@stablyai/playwright-test'
import { focusActiveTerminalInput } from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  browserAddressBar,
  createBrowserSplit,
  createTerminalBrowserSplit,
  focusBrowserAddressBar,
  focusBrowserGroup,
  guestModifier,
  pressKeyInBrowserGuest,
  shortcutModifier as modifier,
  waitForFocusedGroup
} from './helpers/browser-split-fixture'

function browserFindInput(page: Page) {
  return page.getByPlaceholder('Find in page...')
}

function browserFindCloseButton(page: Page) {
  return browserFindInput(page).locator('xpath=..').getByTitle('Close')
}

function browserSplitFindInput(page: Page, browserTabId: string) {
  return page
    .locator(`[data-browser-overlay-tab-id="${browserTabId}"]`)
    .getByPlaceholder('Find in page...')
}

async function pressFindInBrowserGuest(
  page: Page,
  browserTabId: string,
  browserPageId: string
): Promise<void> {
  await pressKeyInBrowserGuest(page, browserTabId, browserPageId, 'F', [guestModifier])
}

function terminalFindInput(page: Page) {
  return page.locator('[data-terminal-search-root] input:visible')
}

test.describe('browser split shortcuts', () => {
  test.beforeEach(async ({ shieldPage }) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    await ensureTerminalVisible(shieldPage)
  })

  test('routes repeated Find shortcuts to the focused terminal or browser split', async ({
    shieldPage
  }) => {
    const fixture = await createTerminalBrowserSplit(shieldPage)

    await shieldPage.evaluate(({ terminalGroupId }) => {
      const state = window.__store?.getState()
      const worktreeId = state?.activeWorktreeId
      if (state && worktreeId) {
        state.focusGroup(worktreeId, terminalGroupId)
      }
    }, fixture)
    await focusActiveTerminalInput(shieldPage)
    await waitForFocusedGroup(shieldPage, fixture.terminalGroupId)
    await shieldPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(shieldPage)).toBeFocused()
    await expect(browserFindInput(shieldPage)).toBeHidden()
    await shieldPage.keyboard.press('Escape')

    await focusBrowserGroup(shieldPage, fixture.browserGroupId)
    await focusBrowserAddressBar(shieldPage, fixture.browserTabId)
    await shieldPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(shieldPage)).toBeFocused()
    await expect(terminalFindInput(shieldPage)).toBeHidden()
    await browserFindCloseButton(shieldPage).click()
    await expect(browserFindInput(shieldPage)).toBeHidden()

    await shieldPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(shieldPage)).toBeFocused()
    await browserFindCloseButton(shieldPage).click()

    await shieldPage.evaluate(({ browserTabId }) => {
      window.__store?.getState().closeBrowserTab(browserTabId)
    }, fixture)
    await expect(
      shieldPage.locator(`[data-browser-overlay-tab-id="${fixture.browserTabId}"]`)
    ).toHaveCount(0)

    await focusActiveTerminalInput(shieldPage)
    await shieldPage.keyboard.press(`${modifier}+f`)
    await expect(terminalFindInput(shieldPage)).toBeFocused()
    await expect(browserFindInput(shieldPage)).toBeHidden()
  })

  test('opens Find only in the browser split whose guest owns the shortcut', async ({
    shieldPage
  }) => {
    const fixture = await createBrowserSplit(shieldPage)

    await pressFindInBrowserGuest(shieldPage, fixture.firstBrowserTabId, fixture.firstBrowserPageId)

    await expect(browserSplitFindInput(shieldPage, fixture.firstBrowserTabId)).toBeVisible()
    await expect(browserSplitFindInput(shieldPage, fixture.secondBrowserTabId)).toBeHidden()
    await expect
      .poll(() =>
        shieldPage.evaluate(
          ({ browserPageId, browserTabId }) =>
            window.__store
              ?.getState()
              .browserPagesByWorkspace[browserTabId]?.find((page) => page.id === browserPageId)
              ?.loadError?.code ?? null,
          {
            browserPageId: fixture.firstBrowserPageId,
            browserTabId: fixture.firstBrowserTabId
          }
        )
      )
      .toBeNull()
  })

  test('keeps browser Find available when split focus state is temporarily missing', async ({
    shieldPage
  }) => {
    const fixture = await createTerminalBrowserSplit(shieldPage)
    await focusBrowserGroup(shieldPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(shieldPage, fixture.browserTabId)
    await focusBrowserAddressBar(shieldPage, fixture.browserTabId)

    await shieldPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => {
        const activeGroupIdByWorktree = { ...state.activeGroupIdByWorktree }
        delete activeGroupIdByWorktree[worktreeId]
        return { activeGroupIdByWorktree }
      })
    })
    await expect(addressBar).toBeFocused()

    await shieldPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(shieldPage)).toBeFocused()
    await expect(terminalFindInput(shieldPage)).toBeHidden()
  })

  test('keeps browser Find available when the focused split ID is stale', async ({ shieldPage }) => {
    const fixture = await createTerminalBrowserSplit(shieldPage)
    await focusBrowserGroup(shieldPage, fixture.browserGroupId)
    const addressBar = browserAddressBar(shieldPage, fixture.browserTabId)
    await focusBrowserAddressBar(shieldPage, fixture.browserTabId)

    await shieldPage.evaluate(() => {
      const store = window.__store
      const worktreeId = store?.getState().activeWorktreeId
      if (!store || !worktreeId) {
        throw new Error('Active worktree unavailable')
      }
      store.setState((state) => ({
        activeGroupIdByWorktree: {
          ...state.activeGroupIdByWorktree,
          [worktreeId]: 'removed-group'
        }
      }))
    })
    await expect(addressBar).toBeFocused()

    await shieldPage.keyboard.press(`${modifier}+f`)
    await expect(browserFindInput(shieldPage)).toBeFocused()
    await expect(terminalFindInput(shieldPage)).toBeHidden()
  })
})
