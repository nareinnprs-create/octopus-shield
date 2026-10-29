// Require @headful WebGL for context-loss and split-restore race coverage.

import { test, expect } from './helpers/shield-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'
import { waitForActiveTerminalManager, waitForPaneCount } from './helpers/terminal'
import {
  createAndActivateWorktreeWithManualSplit,
  removeWorktreeViaStore,
  waitForAllPanesToHaveContent
} from './helpers/dead-terminal'

const STRESS_ITERATIONS = 5

test.describe('Dead Terminal Stress @headful', () => {
  const createdWorktreeIds: string[] = []

  test.beforeEach(async ({ shieldPage }) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    await ensureTerminalVisible(shieldPage)
  })

  test.afterEach(async ({ shieldPage }) => {
    for (const id of createdWorktreeIds) {
      await removeWorktreeViaStore(shieldPage, id)
    }
    createdWorktreeIds.length = 0
  })

  // Force context loss like Chromium under memory pressure; recovery must fall back to DOM then fit/refresh.
  test('@headful manual-split with forced WebGL context loss recovers', async ({ shieldPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(shieldPage)
    await waitForActiveTerminalManager(shieldPage, 30_000)

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const newId = await createAndActivateWorktreeWithManualSplit(
        shieldPage,
        `ctxloss-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(shieldPage)
      await waitForActiveTerminalManager(shieldPage, 30_000)
      await waitForPaneCount(shieldPage, 2, 15_000)

      const lostCount = await shieldPage.evaluate(() => {
        const canvases = document.querySelectorAll('.pane canvas:not(.xterm-link-layer)')
        let lost = 0
        for (const canvas of canvases) {
          const gl =
            (canvas as HTMLCanvasElement).getContext('webgl2') ??
            (canvas as HTMLCanvasElement).getContext('webgl')
          if (gl) {
            const ext = gl.getExtension('WEBGL_lose_context')
            if (ext) {
              ext.loseContext()
              lost++
            }
          }
        }
        return lost
      })
      if (lostCount > 0) {
        console.log(`[ctxloss-${i}] Forced context loss on ${lostCount} canvases`)
      }

      await shieldPage.waitForTimeout(500)
      await waitForAllPanesToHaveContent(shieldPage, `ctxloss-${i} after context loss`)

      await switchToWorktree(shieldPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(shieldPage, newId)
      createdWorktreeIds.pop()
    }
  })

  // Switch before split settlement to race reparenting, WebGL resume and the 200ms scroll-restore timer.
  test('@headful rapid worktree switching during manual-split lifecycle', async ({ shieldPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(shieldPage)
    await waitForActiveTerminalManager(shieldPage, 30_000)

    for (let i = 0; i < 3; i++) {
      const newId = await createAndActivateWorktreeWithManualSplit(
        shieldPage,
        `rapid-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)

      // Switch away during the ~200ms scheduleSplitScrollRestore window
      await shieldPage.waitForTimeout(50)
      await switchToWorktree(shieldPage, homeWorktreeId)
      await shieldPage.waitForTimeout(50)

      await switchToWorktree(shieldPage, newId)
      await expect.poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(shieldPage)
      await waitForActiveTerminalManager(shieldPage, 30_000)
      await waitForPaneCount(shieldPage, 2, 15_000)
      await waitForAllPanesToHaveContent(shieldPage, `rapid-${i} after return`)

      await switchToWorktree(shieldPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(shieldPage, newId)
      createdWorktreeIds.pop()
    }
  })
})
