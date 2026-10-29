import type { Page } from '@stablyai/playwright-test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect } from './helpers/shield-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { readPaneIdentitySnapshot } from './helpers/terminal'
import { attachRepoAndOpenTerminal, createRestartSession } from './helpers/shield-restart'
import {
  addRepoWithWorkspaces,
  linkWorkspaces,
  writeWorkspaceMeta
} from './helpers/repo-with-workspaces'
import { dismissSetupScriptPrompts } from './helpers/sidebar-setup-prompt'
import { seedLineageScenario, seedWorkspaceLiveTerminal } from './worktree-lineage-state'

test.use({ launchEnv: { OSHIELD_BACKGROUND_LAUNCH: '1' } })

const ACTION_ID = 'sidebar.childWorkspaces.toggle' as const
const CHORD = 'ControlOrMeta+Alt+KeyH'

function sidebarWorktreeRow(page: Page, worktreeId: string) {
  return page
    .locator(
      `[data-worktree-sidebar] [role="option"][data-worktree-id=${JSON.stringify(worktreeId)}]`
    )
    .first()
}

async function waitForLineageWorktrees(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const store = window.__store
          if (!store) {
            return 0
          }
          for (const repo of store.getState().repos) {
            await store.getState().fetchWorktrees(repo.id)
          }
          return Object.values(store.getState().worktreesByRepo)
            .flat()
            .filter((worktree) => !worktree.isArchived).length
        }),
      { timeout: 30_000 }
    )
    .toBeGreaterThanOrEqual(2)
}

async function captureEvidence(page: Page, name: string): Promise<void> {
  if (process.env.OSHIELD_CAPTURE_EVIDENCE !== '1') {
    return
  }
  const directory = join(process.cwd(), 'pr-evidence')
  mkdirSync(directory, { recursive: true })
  await page.screenshot({ path: join(directory, name) })
}

async function setToggleBinding(page: Page, bindings: string[] | null): Promise<void> {
  await page.evaluate(
    async ({ actionId, bindings }) => {
      const store = window.__store
      if (!store) {
        throw new Error('window.__store is not available')
      }
      const state = store.getState()
      await (bindings
        ? state.setKeybindingOverride(actionId, bindings)
        : state.resetKeybindingOverride(actionId))
    },
    { actionId: ACTION_ID, bindings }
  )
}

async function movePointerOffSidebar(page: Page): Promise<void> {
  const viewport =
    page.viewportSize() ??
    (await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight
    })))
  await page.mouse.move(viewport.width - 20, viewport.height / 2)
}

async function observeShortcutClaim(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.addEventListener('keydown', (event) => {
      if (event.code === 'KeyH') {
        document.body.dataset.childToggleClaimed = String(event.defaultPrevented)
      }
    })
  })
}

test.describe('Toggle Child Workspaces shortcut', () => {
  test.beforeEach(async ({ shieldPage, electronApp }) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    expect(
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every((window) => !window.isVisible())
      )
    ).toBe(true)
  })

  test.afterEach(async ({ shieldPage }) => {
    await setToggleBinding(shieldPage, null)
  })

  test('Settings exposes the unbound action and records an assigned shortcut', async ({
    shieldPage
  }) => {
    await shieldPage.evaluate(async () => {
      await window.__store?.getState().updateSettings({ uiLanguage: 'en' })
      window.__store?.getState().openSettingsPage()
    })
    await shieldPage.getByPlaceholder('Search settings').fill('shortcuts')
    const search = shieldPage.getByPlaceholder('Search command or keys')
    await expect(search).toBeVisible()
    await search.fill('Toggle Child Workspaces')
    await expect(shieldPage.getByText('Toggle Child Workspaces', { exact: true })).toBeVisible()
    const add = shieldPage.getByRole('button', { name: 'Add shortcut for Toggle Child Workspaces' })
    await expect(add).toBeVisible()
    await captureEvidence(shieldPage, 'child-toggle-settings-unbound.png')

    await add.click()
    const recorder = shieldPage.locator('[data-shortcut-recorder-active]')
    await expect(recorder).toBeVisible()
    await recorder.press(CHORD)
    await expect(
      shieldPage.getByRole('button', { name: 'Change shortcut for Toggle Child Workspaces' })
    ).toBeVisible()
    await captureEvidence(shieldPage, 'child-toggle-settings-assigned.png')
  })

  test('hides and shows children of the active or hovered workspace', async ({ shieldPage }) => {
    const { parentId, childId } = await seedLineageScenario(shieldPage)
    await setToggleBinding(shieldPage, ['Mod+Alt+H'])
    const parentRow = sidebarWorktreeRow(shieldPage, parentId)
    const childRow = sidebarWorktreeRow(shieldPage, childId)

    await parentRow.click()
    await expect(parentRow).toHaveAttribute('aria-current', 'page')
    await expect(childRow).toBeVisible()
    await captureEvidence(shieldPage, 'child-toggle-sidebar-expanded.png')

    // No hovered card: the active parent is the target.
    await movePointerOffSidebar(shieldPage)
    await shieldPage.keyboard.press(CHORD)
    await expect(childRow).toBeHidden()
    await expect(parentRow.getByRole('button', { name: 'Show 1 child workspace' })).toBeVisible()
    await captureEvidence(shieldPage, 'child-toggle-sidebar-collapsed.png')

    await shieldPage.keyboard.press(CHORD)
    await expect(childRow).toBeVisible()
    await expect(parentRow.getByRole('button', { name: 'Hide 1 child workspace' })).toBeVisible()

    await childRow.click()
    await expect(childRow).toHaveAttribute('aria-current', 'page')
    await movePointerOffSidebar(shieldPage)
    await shieldPage.keyboard.press(CHORD)
    await expect(childRow).toBeHidden()
    await shieldPage.keyboard.press(CHORD)
    await expect(childRow).toBeVisible()
    await parentRow.click()

    // A hovered leaf child folds its parent.
    await childRow.hover()
    await shieldPage.keyboard.press(CHORD)
    await expect(childRow).toBeHidden()
    await expect(parentRow.getByRole('button', { name: 'Show 1 child workspace' })).toBeVisible()

    // A hovered parent unfolds its own children.
    await parentRow.hover()
    await shieldPage.keyboard.press(CHORD)
    await expect(childRow).toBeVisible()
  })

  test('a modal keeps its shortcut input while the parent chip is visible', async ({
    shieldPage
  }) => {
    const { parentId, childId } = await seedLineageScenario(shieldPage)
    await setToggleBinding(shieldPage, ['Mod+Alt+H'])
    await shieldPage.evaluate(() => window.__store?.getState().openModal('worktree-palette'))
    await expect(shieldPage.getByRole('dialog')).toBeVisible()
    await shieldPage.getByRole('dialog').evaluate((dialog) => {
      dialog.setAttribute('tabindex', '-1')
      dialog.focus()
    })
    await shieldPage.keyboard.press(CHORD)
    await expect(
      sidebarWorktreeRow(shieldPage, parentId).getByRole('button', {
        name: 'Hide 1 child workspace',
        includeHidden: true
      })
    ).toBeVisible()
    await expect(sidebarWorktreeRow(shieldPage, childId)).toBeVisible()
    await shieldPage.keyboard.press('Escape')
  })

  test('a hovered parent takes precedence over another active family', async ({
    shieldPage
  }, testInfo) => {
    const { childId } = await seedLineageScenario(shieldPage)
    await setToggleBinding(shieldPage, ['Mod+Alt+H'])
    const otherRepo = await addRepoWithWorkspaces(shieldPage, testInfo, 2)
    const other = { parentId: otherRepo.ids[0]!, childId: otherRepo.ids[1]! }
    await writeWorkspaceMeta(shieldPage, [
      { worktreeId: other.parentId, updates: { displayName: 'Another parent' } },
      { worktreeId: other.childId, updates: { displayName: 'Another child' } }
    ])
    await linkWorkspaces(shieldPage, [other])
    await expect(sidebarWorktreeRow(shieldPage, other.childId)).toBeVisible()
    await sidebarWorktreeRow(shieldPage, other.parentId).hover()
    await shieldPage.keyboard.press(CHORD)
    await expect(sidebarWorktreeRow(shieldPage, other.childId)).toBeHidden()
    await expect(sidebarWorktreeRow(shieldPage, childId)).toBeVisible()
    await captureEvidence(shieldPage, 'child-toggle-hover-precedence.png')
  })

  test('a focused floating workspace keeps the shortcut input', async ({ shieldPage }) => {
    const { parentId, childId } = await seedLineageScenario(shieldPage)
    await setToggleBinding(shieldPage, ['Mod+Alt+H'])
    await shieldPage.getByRole('button', { name: 'Show floating workspace', exact: true }).click()
    const panel = shieldPage.locator('[data-floating-terminal-panel][aria-hidden="false"]')
    await expect(panel).toBeVisible()
    await panel.locator('[data-floating-terminal-shortcut-surface]').first().focus()
    await shieldPage.keyboard.press(CHORD)
    await expect(
      sidebarWorktreeRow(shieldPage, parentId).getByRole('button', { name: 'Hide 1 child workspace' })
    ).toBeVisible()
    await expect(sidebarWorktreeRow(shieldPage, childId)).toBeVisible()
    await captureEvidence(shieldPage, 'child-toggle-floating-guard.png')
  })

  test('a stale child instance leaves no chip and does not claim the chord', async ({
    shieldPage
  }) => {
    const { parentId, childId } = await seedLineageScenario(shieldPage)
    await setToggleBinding(shieldPage, ['Mod+Alt+H'])
    // Stands in for recreating the child at the same path: its new instance no longer matches the link.
    await writeWorkspaceMeta(shieldPage, [
      { worktreeId: childId, updates: { instanceId: 'recreated-child' } }
    ])
    const parentRow = sidebarWorktreeRow(shieldPage, parentId)
    await expect(parentRow.getByRole('button', { name: /child workspace/ })).toHaveCount(0)
    await parentRow.click()
    await shieldPage.locator('[data-worktree-sidebar]').focus()
    await movePointerOffSidebar(shieldPage)
    await observeShortcutClaim(shieldPage)
    await shieldPage.keyboard.press(CHORD)
    await expect(shieldPage.locator('body')).toHaveAttribute('data-child-toggle-claimed', 'false')
    await expect(sidebarWorktreeRow(shieldPage, childId)).toBeVisible()
    await captureEvidence(shieldPage, 'child-toggle-stale-no-chip.png')
  })

  test('folder cards pass the chord through while another family has a chip', async ({
    shieldPage
  }) => {
    const { parentId, childId } = await seedLineageScenario(shieldPage)
    await setToggleBinding(shieldPage, ['Mod+Alt+H'])
    const folderKey = await shieldPage.evaluate(async () => {
      const store = window.__store
      const repo = store?.getState().repos[0]
      if (!store || !repo) {
        throw new Error('Missing seeded project')
      }
      const group = await window.api.projectGroups.create({
        name: 'Folder project',
        parentPath: repo.path,
        createdFrom: 'manual'
      })
      await store.getState().fetchProjectGroups({ runtimeEnvironmentId: null, throwOnError: true })
      const folder = await store.getState().createFolderWorkspace(
        {
          projectGroupId: group.id,
          name: 'Folder without a child chip',
          folderPath: repo.path
        },
        { runtimeEnvironmentId: null }
      )
      if (!folder) {
        throw new Error('Missing created folder workspace')
      }
      return `folder:${folder.id}`
    })
    const folder = sidebarWorktreeRow(shieldPage, folderKey)
    await expect(folder).toBeVisible()
    await expect(folder.getByRole('button', { name: /child workspace/ })).toHaveCount(0)
    await dismissSetupScriptPrompts(shieldPage)
    await sidebarWorktreeRow(shieldPage, parentId).click()
    await shieldPage.locator('[data-worktree-sidebar]').focus()
    await folder.hover()
    await observeShortcutClaim(shieldPage)
    await shieldPage.keyboard.press(CHORD)
    await expect(shieldPage.locator('body')).toHaveAttribute('data-child-toggle-claimed', 'false')
    await expect(sidebarWorktreeRow(shieldPage, childId)).toBeVisible()
    await folder.click()
    await expect(folder).toHaveAttribute('aria-current', 'page')
    await shieldPage.locator('[data-worktree-sidebar]').focus()
    await movePointerOffSidebar(shieldPage)
    await shieldPage.keyboard.press(CHORD)
    await expect(shieldPage.locator('body')).toHaveAttribute('data-child-toggle-claimed', 'false')
    await expect(sidebarWorktreeRow(shieldPage, childId)).toBeVisible()
    await expect
      .poll(async () => {
        if ((await shieldPage.locator('[data-terminal-error-toast]').count()) > 0) {
          return 'error'
        }
        const snapshot = await readPaneIdentitySnapshot(shieldPage)
        if (!snapshot) {
          return 'pending'
        }
        const folderOwnsTab = await shieldPage.evaluate(
          ({ folderKey, tabId }) => {
            const state = window.__store?.getState()
            return (
              state?.activeWorktreeId === folderKey &&
              (state.tabsByWorktree[folderKey] ?? []).some((tab) => tab.id === tabId)
            )
          },
          { folderKey, tabId: snapshot.tabId }
        )
        return folderOwnsTab &&
          snapshot.panes.some(
            (pane) => pane.ptyId !== null && snapshot.ptyIdsByLeafId[pane.leafId] === pane.ptyId
          )
          ? 'ready'
          : 'pending'
      })
      .not.toBe('pending')
    await expect(shieldPage.locator('[data-terminal-error-toast]')).toHaveCount(0)
    await captureEvidence(shieldPage, 'child-toggle-folder-pass-through.png')
  })

  test('pinned duplicates share the chip state and record the sidebar anchor', async ({
    shieldPage
  }) => {
    const { parentId, childId } = await seedLineageScenario(shieldPage)
    await setToggleBinding(shieldPage, ['Mod+Alt+H'])
    await writeWorkspaceMeta(shieldPage, [{ worktreeId: parentId, updates: { isPinned: true } }])
    await shieldPage.evaluate(async () => {
      await window.__store?.getState().updateSettings({ showPinnedWorktreesInGroups: true })
      const sidebar = document.querySelector<HTMLElement>('[data-worktree-sidebar]')
      sidebar?.addEventListener('shield-record-virtualized-scroll-anchor', () => {
        sidebar.dataset.anchorRecords = String(Number(sidebar.dataset.anchorRecords ?? 0) + 1)
      })
    })
    const chips = shieldPage.getByRole('button', { name: 'Hide 1 child workspace', exact: true })
    await expect(chips).toHaveCount(2)
    const natural = shieldPage
      .locator('[data-worktree-section-key="all"]')
      .filter({ has: chips })
      .first()
    await natural.hover()
    await shieldPage.keyboard.press(CHORD)
    await expect(
      shieldPage.getByRole('button', { name: 'Show 1 child workspace', exact: true })
    ).toHaveCount(2)
    await expect(shieldPage.locator('[data-worktree-sidebar]')).toHaveAttribute(
      'data-anchor-records',
      '1'
    )
    await expect(sidebarWorktreeRow(shieldPage, childId)).toBeHidden()
    await shieldPage
      .getByRole('button', { name: 'Show 1 child workspace', exact: true })
      .first()
      .click()
    await expect(chips).toHaveCount(2)
    await expect(shieldPage.locator('[data-worktree-sidebar]')).toHaveAttribute(
      'data-anchor-records',
      '2'
    )
    await captureEvidence(shieldPage, 'child-toggle-pinned-chip-parity.png')
  })

  test('does nothing while a sidebar filter hides every child', async ({ shieldPage }) => {
    const { parentId, childId } = await seedLineageScenario(shieldPage)
    await setToggleBinding(shieldPage, ['Mod+Alt+H'])
    await seedWorkspaceLiveTerminal(shieldPage, parentId)
    const parentRow = sidebarWorktreeRow(shieldPage, parentId)
    const childRow = sidebarWorktreeRow(shieldPage, childId)
    await parentRow.click()
    await expect(parentRow).toHaveAttribute('aria-current', 'page')

    const readCollapsedGroups = (): Promise<string[]> =>
      shieldPage.evaluate(() => [...(window.__store?.getState().collapsedGroups ?? [])].sort())
    const setShowSleeping = (show: boolean): Promise<void> =>
      shieldPage.evaluate((show) => window.__store?.getState().setShowSleepingWorkspaces(show), show)

    // The child has no live terminal, so hiding sleeping workspaces removes it and its chip.
    await setShowSleeping(false)
    try {
      await expect(childRow).toBeHidden()
      await expect(parentRow.getByRole('button', { name: /child workspace/ })).toHaveCount(0)
      const before = await readCollapsedGroups()

      // Checked after each press: two toggles of one key would cancel out.
      await movePointerOffSidebar(shieldPage)
      await shieldPage.keyboard.press(CHORD)
      expect(await readCollapsedGroups()).toEqual(before)
      await parentRow.hover()
      await shieldPage.keyboard.press(CHORD)
      expect(await readCollapsedGroups()).toEqual(before)
    } finally {
      await setShowSleeping(true)
    }
    await expect(childRow).toBeVisible()
  })
})

test('child-workspace shortcut and chip collapse survive an app restart', async ({
  testRepoPath
}, testInfo) => {
  const session = createRestartSession(testInfo)
  let app: Awaited<ReturnType<typeof session.launch>>['app'] | undefined
  try {
    const first = await session.launch()
    app = first.app
    await attachRepoAndOpenTerminal(first.page, testRepoPath)
    await waitForLineageWorktrees(first.page)
    const family = await seedLineageScenario(first.page)
    await setToggleBinding(first.page, ['Mod+Alt+H'])
    await sidebarWorktreeRow(first.page, family.parentId).click()
    await movePointerOffSidebar(first.page)
    await first.page.keyboard.press(CHORD)
    await expect(sidebarWorktreeRow(first.page, family.childId)).toBeHidden()
    await session.close(app)
    app = undefined

    const second = await session.launch()
    app = second.app
    await attachRepoAndOpenTerminal(second.page, testRepoPath)
    await waitForLineageWorktrees(second.page)
    // Resetting the grouping mode also clears the persisted collapsed groups.
    await seedLineageScenario(second.page, { preserveGrouping: true })
    await expect(
      sidebarWorktreeRow(second.page, family.parentId).getByRole('button', {
        name: 'Show 1 child workspace'
      })
    ).toBeVisible()
    await expect(sidebarWorktreeRow(second.page, family.childId)).toBeHidden()
    await movePointerOffSidebar(second.page)
    await second.page.keyboard.press(CHORD)
    await expect(sidebarWorktreeRow(second.page, family.childId)).toBeVisible()
    await captureEvidence(second.page, 'child-toggle-restart-persistence.png')
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
  }
})
