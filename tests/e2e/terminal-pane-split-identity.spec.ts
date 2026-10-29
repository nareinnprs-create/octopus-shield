// Require stable split-leaf UUIDs across PTY binding, OSHIELD_PANE_KEY and context menu.

import { test, expect } from './helpers/shield-app'
import {
  UUID_RE,
  discoverActivePtyId,
  execInTerminal,
  countVisibleTerminalPanes,
  splitActiveTerminalPane,
  waitForPaneIdentitySnapshot,
  waitForTerminalOutput,
  waitForPaneCount
} from './helpers/terminal'
import { openTerminalContextMenu } from './helpers/terminal-pane-title-actions'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('can split terminal pane right', async ({ shieldPage }) => {
    const paneCountBefore = await countVisibleTerminalPanes(shieldPage)

    await splitActiveTerminalPane(shieldPage, 'vertical')
    await waitForPaneCount(shieldPage, paneCountBefore + 1)

    const paneCountAfter = await countVisibleTerminalPanes(shieldPage)
    expect(paneCountAfter).toBe(paneCountBefore + 1)
  })

  test('can split terminal pane down', async ({ shieldPage }) => {
    const paneCountBefore = await countVisibleTerminalPanes(shieldPage)

    await splitActiveTerminalPane(shieldPage, 'horizontal')
    await waitForPaneCount(shieldPage, paneCountBefore + 1)

    const paneCountAfter = await countVisibleTerminalPanes(shieldPage)
    expect(paneCountAfter).toBe(paneCountBefore + 1)
  })

  test('split panes persist PTY bindings by stable UUID leaf id', async ({ shieldPage }) => {
    const paneCountBefore = await countVisibleTerminalPanes(shieldPage)

    await splitActiveTerminalPane(shieldPage, 'vertical')
    await waitForPaneCount(shieldPage, paneCountBefore + 1)

    const snapshot = await waitForPaneIdentitySnapshot(shieldPage, paneCountBefore + 1)
    const leafIds = snapshot.panes.map((pane) => pane.leafId)
    const ptyIds = snapshot.panes.map((pane) => pane.ptyId)

    expect(new Set(leafIds).size).toBe(leafIds.length)
    expect(new Set(ptyIds).size).toBe(ptyIds.length)
    expect(Object.keys(snapshot.ptyIdsByLeafId).sort()).toEqual([...leafIds].sort())
    expect(Object.keys(snapshot.ptyIdsByLeafId).every((leafId) => UUID_RE.test(leafId))).toBe(true)
    expect(
      snapshot.panes.some(
        (pane) =>
          String(pane.numericPaneId) === pane.leafId || `pane:${pane.numericPaneId}` === pane.leafId
      )
    ).toBe(false)
  })

  test('terminal process receives OSHIELD_PANE_KEY with the active UUID leaf id', async ({
    shieldPage
  }) => {
    const snapshot = await waitForPaneIdentitySnapshot(shieldPage, 1)
    const activeLeafId = snapshot.activeLeafId ?? snapshot.panes[0]?.leafId
    if (!activeLeafId) {
      throw new Error('No active pane leaf id found')
    }

    const expectedPaneKey = `${snapshot.tabId}:${activeLeafId}`
    const ptyId = await discoverActivePtyId(shieldPage)
    const marker = `OSHIELD_PANE_KEY_E2E_${Date.now()}`

    await execInTerminal(shieldPage, ptyId, `printf '${marker}=%s\\n' "$OSHIELD_PANE_KEY"`)
    await waitForTerminalOutput(shieldPage, `${marker}=${expectedPaneKey}`)

    expect(activeLeafId).toMatch(UUID_RE)
  })

  test('terminal context menu copies the stable pane ID', async ({ shieldPage }) => {
    const snapshot = await waitForPaneIdentitySnapshot(shieldPage, 1)
    const leafId = snapshot.panes[0]?.leafId
    if (!leafId) {
      throw new Error('No terminal pane leaf id found')
    }
    const expectedPaneKey = `${snapshot.tabId}:${leafId}`

    await openTerminalContextMenu(shieldPage)
    await shieldPage.getByText('Copy Pane ID', { exact: true }).click()

    await expect
      .poll(() => shieldPage.evaluate(() => window.api.ui.readClipboardText()), { timeout: 3_000 })
      .toBe(expectedPaneKey)
    await expect(shieldPage.getByText('Pane ID copied', { exact: true })).toBeVisible()
    expect(leafId).toMatch(UUID_RE)
  })
})
