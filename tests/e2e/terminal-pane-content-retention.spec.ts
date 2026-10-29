// Require scrollback retention across tab, pane and worktree changes.

import { test, expect } from './helpers/shield-app'
import {
  discoverActivePtyId,
  execInTerminal,
  closeActiveTerminalPane,
  countVisibleTerminalPanes,
  focusLastTerminalPane,
  splitActiveTerminalPane,
  waitForTerminalOutput,
  waitForPaneCount,
  getTerminalContent
} from './helpers/terminal'
import {
  getActiveWorktreeId,
  getActiveTabType,
  getWorktreeTabs,
  getAllWorktreeIds,
  switchToOtherWorktree,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { pressShortcut } from './helpers/shortcuts'
import { registerTerminalPaneMountReadiness } from './helpers/terminal-pane-mount-readiness'

// Serialize headful scenarios; visible-window runs require an isolated display.
test.describe.configure({ mode: 'serial' })
test.describe('Terminal Panes', () => {
  registerTerminalPaneMountReadiness()

  test('terminal pane retains content when switching tabs and back', async ({ shieldPage }) => {
    const ptyId = await discoverActivePtyId(shieldPage)
    const marker = `RETAIN_TEST_${Date.now()}`
    await execInTerminal(shieldPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(shieldPage, marker)

    const worktreeId = (await getActiveWorktreeId(shieldPage))!
    await pressShortcut(shieldPage, 't')

    await expect
      .poll(async () => (await getWorktreeTabs(shieldPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThanOrEqual(2)

    const activeType = await getActiveTabType(shieldPage)
    expect(activeType).toBe('terminal')

    await pressShortcut(shieldPage, 'BracketLeft', { shift: true })

    await expect
      .poll(async () => (await getTerminalContent(shieldPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)

    await pressShortcut(shieldPage, 'BracketRight', { shift: true })
    await pressShortcut(shieldPage, 'w')
  })

  test('terminal pane retains content when splitting and closing a pane', async ({ shieldPage }) => {
    const ptyId = await discoverActivePtyId(shieldPage)
    const marker = `SPLIT_RETAIN_${Date.now()}`
    await execInTerminal(shieldPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(shieldPage, marker)

    const panesBefore = await countVisibleTerminalPanes(shieldPage)

    await splitActiveTerminalPane(shieldPage, 'vertical')
    await waitForPaneCount(shieldPage, panesBefore + 1)

    await focusLastTerminalPane(shieldPage)
    await closeActiveTerminalPane(shieldPage)
    await waitForPaneCount(shieldPage, panesBefore)

    await expect
      .poll(async () => (await getTerminalContent(shieldPage)).includes(marker), { timeout: 5_000 })
      .toBe(true)
  })

  test('terminal pane retains content when switching worktrees and back', async ({ shieldPage }) => {
    const allWorktreeIds = await getAllWorktreeIds(shieldPage)
    if (allWorktreeIds.length < 2) {
      test.skip(true, 'Need at least 2 worktrees to test worktree switching')
      return
    }

    const worktreeId = (await getActiveWorktreeId(shieldPage))!

    const ptyId = await discoverActivePtyId(shieldPage)
    const marker = `WT_RETAIN_${Date.now()}`
    await execInTerminal(shieldPage, ptyId, `echo ${marker}`)
    await waitForTerminalOutput(shieldPage, marker)

    const otherId = await switchToOtherWorktree(shieldPage, worktreeId)
    expect(otherId).not.toBeNull()
    await expect.poll(async () => getActiveWorktreeId(shieldPage), { timeout: 5_000 }).toBe(otherId)

    await switchToWorktree(shieldPage, worktreeId)
    await expect
      .poll(async () => getActiveWorktreeId(shieldPage), { timeout: 5_000 })
      .toBe(worktreeId)

    // Poll the retained marker after worktree return: serialize-addon rebind can lag the activation cascade, so avoid an earlier manager-timing assertion.
    await ensureTerminalVisible(shieldPage)

    await expect
      .poll(async () => (await getTerminalContent(shieldPage)).includes(marker), { timeout: 20_000 })
      .toBe(true)
  })
})
