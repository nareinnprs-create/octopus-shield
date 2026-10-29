// Require @headful WebGL: DOM fallback cannot reproduce canvas staleness after split reparenting.

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
  waitForAllPanesToHaveContent,
  checkWebglState
} from './helpers/dead-terminal'

const STRESS_ITERATIONS = 5

test.describe('Dead Terminal Reproduction @headful', () => {
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

  test('@headful manual-split flow does not produce dead terminals', async ({ shieldPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(shieldPage)
    await waitForActiveTerminalManager(shieldPage, 30_000)
    await checkWebglState(shieldPage, 'home-initial')

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const direction = i % 2 === 0 ? 'vertical' : 'horizontal'
      const newId = await createAndActivateWorktreeWithManualSplit(
        shieldPage,
        `setup-${i}`,
        direction
      )
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(shieldPage)
      await waitForActiveTerminalManager(shieldPage, 30_000)
      await waitForPaneCount(shieldPage, 2, 15_000)
      await checkWebglState(shieldPage, `setup-${i}`)
      await waitForAllPanesToHaveContent(shieldPage, `setup-${i} both panes`)

      await switchToWorktree(shieldPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(shieldPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful manual-split then switch-back does not leave panes dead', async ({ shieldPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(shieldPage)
    await waitForActiveTerminalManager(shieldPage, 30_000)

    for (let i = 0; i < STRESS_ITERATIONS; i++) {
      const newId = await createAndActivateWorktreeWithManualSplit(
        shieldPage,
        `switchback-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(shieldPage)
      await waitForActiveTerminalManager(shieldPage, 30_000)
      await waitForPaneCount(shieldPage, 2, 15_000)
      await waitForAllPanesToHaveContent(shieldPage, `switchback-${i} initial`)

      await switchToWorktree(shieldPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await ensureTerminalVisible(shieldPage)
      await waitForActiveTerminalManager(shieldPage, 15_000)

      await switchToWorktree(shieldPage, newId)
      await expect.poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(shieldPage)
      await waitForActiveTerminalManager(shieldPage, 15_000)
      await waitForAllPanesToHaveContent(shieldPage, `switchback-${i} after return`)

      await switchToWorktree(shieldPage, homeWorktreeId)
      await expect
        .poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 })
        .toBe(homeWorktreeId)
      await removeWorktreeViaStore(shieldPage, newId)
      createdWorktreeIds.pop()
    }
  })

  test('@headful rapid switching between many manual-split worktrees', async ({ shieldPage }) => {
    test.setTimeout(120_000)
    const homeWorktreeId = await waitForActiveWorktree(shieldPage)
    await waitForActiveTerminalManager(shieldPage, 30_000)

    const worktreeIds = [homeWorktreeId]
    for (let i = 0; i < 4; i++) {
      const newId = await createAndActivateWorktreeWithManualSplit(
        shieldPage,
        `multi-${i}`,
        'vertical'
      )
      createdWorktreeIds.push(newId)
      worktreeIds.push(newId)

      await expect.poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 }).toBe(newId)
      await ensureTerminalVisible(shieldPage)
      await waitForActiveTerminalManager(shieldPage, 30_000)
      await waitForPaneCount(shieldPage, 2, 15_000)
      await waitForAllPanesToHaveContent(shieldPage, `multi-create-${i}`)
    }

    for (let round = 0; round < 3; round++) {
      for (const wId of worktreeIds) {
        await switchToWorktree(shieldPage, wId)
        await expect.poll(async () => getActiveWorktreeId(shieldPage), { timeout: 10_000 }).toBe(wId)
        await ensureTerminalVisible(shieldPage)
        await waitForActiveTerminalManager(shieldPage, 15_000)
        await waitForAllPanesToHaveContent(shieldPage, `multi-r${round}-${wId.slice(0, 8)}`)
      }
    }
  })
})
