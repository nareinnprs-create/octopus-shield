import { test, expect } from './helpers/shield-app'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  getActiveTabType,
  getOpenFiles,
  ensureTerminalVisible
} from './helpers/store'
import { clickFileInExplorer, openFileExplorer } from './helpers/file-explorer'

async function switchToTerminal(
  page: Parameters<typeof getActiveWorktreeId>[0],
  worktreeId: string
): Promise<void> {
  await page.evaluate((targetWorktreeId) => {
    const store = window.__store
    if (!store) {
      return
    }

    const state = store.getState()
    const terminalTab = (state.tabsByWorktree[targetWorktreeId] ?? [])[0]
    if (terminalTab) {
      state.setActiveTab(terminalTab.id)
    }
    state.setActiveTabType('terminal', store.getState().activeWorktreeId)
  }, worktreeId)
}

async function switchToEditor(
  page: Parameters<typeof getActiveWorktreeId>[0],
  fileId: string
): Promise<void> {
  await page.evaluate((targetFileId) => {
    const store = window.__store
    if (!store) {
      return
    }

    const state = store.getState()
    if (state.openFiles.some((file) => file.id === targetFileId)) {
      state.setActiveFile(targetFileId)
      state.setActiveTabType('editor', store.getState().activeWorktreeId)
    }
  }, fileId)
}

test.describe('File Open & Markdown Preview', () => {
  test.beforeEach(async ({ shieldPage }) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    await ensureTerminalVisible(shieldPage)
  })

  test('opening the right sidebar shows file explorer', async ({ shieldPage }) => {
    await openFileExplorer(shieldPage)

    // Assert the rendered explorer shell; store selection alone cannot detect mount failure.
    await expect(shieldPage.locator('[data-shield-explorer-shell]')).toBeVisible({ timeout: 5_000 })
  })

  test('clicking a file in the file explorer opens it in an editor tab', async ({ shieldPage }) => {
    const worktreeId = (await getActiveWorktreeId(shieldPage))!
    await openFileExplorer(shieldPage)

    const filesBefore = await getOpenFiles(shieldPage, worktreeId)

    const clickedFile = await clickFileInExplorer(shieldPage, [
      'package.json',
      'tsconfig.json',
      '.gitignore',
      'README.md'
    ])
    expect(clickedFile).not.toBeNull()

    await expect.poll(async () => getActiveTabType(shieldPage), { timeout: 5_000 }).toBe('editor')

    await expect
      .poll(async () => (await getOpenFiles(shieldPage, worktreeId)).length, { timeout: 5_000 })
      .toBeGreaterThan(filesBefore.length)

    // Assert the rendered path; allow first-open lazy EditorPanel/Monaco/Markdown chunks to mount.
    await expect(shieldPage.locator('.editor-header-path').first()).toContainText(clickedFile!, {
      timeout: 20_000
    })
  })

  test('opening a .md file shows markdown content', async ({ shieldPage }) => {
    await openFileExplorer(shieldPage)
    const clickedFile = await clickFileInExplorer(shieldPage, ['README.md', 'CLAUDE.md'])
    expect(clickedFile).not.toBeNull()

    await expect.poll(async () => getActiveTabType(shieldPage), { timeout: 5_000 }).toBe('editor')

    // Assert the file’s real heading so a blank editor cannot pass via store state.
    const expectedHeading = clickedFile?.endsWith('README.md')
      ? /Shield E2E Test Repo/i
      : /CLAUDE\.md/i
    // Allow cold EditorPanel → Markdown chunk loading and ProseMirror boot before the heading paints.
    await expect(shieldPage.getByRole('heading', { name: expectedHeading, level: 1 })).toBeVisible({
      timeout: 25_000
    })
  })

  test('editor tab retains state when switching to terminal and back', async ({ shieldPage }) => {
    const worktreeId = (await getActiveWorktreeId(shieldPage))!
    await openFileExplorer(shieldPage)

    const clickedFile = await clickFileInExplorer(shieldPage, [
      'package.json',
      'tsconfig.json',
      '.gitignore'
    ])
    expect(clickedFile).not.toBeNull()

    await expect.poll(async () => getActiveTabType(shieldPage), { timeout: 5_000 }).toBe('editor')

    const openFilesBefore = await getOpenFiles(shieldPage, worktreeId)
    expect(openFilesBefore.length).toBeGreaterThan(0)

    const editorFileId = openFilesBefore[0].id

    await switchToTerminal(shieldPage, worktreeId)
    await expect.poll(async () => getActiveTabType(shieldPage), { timeout: 3_000 }).not.toBe('editor')

    await switchToEditor(shieldPage, editorFileId)
    await expect.poll(async () => getActiveTabType(shieldPage), { timeout: 3_000 }).toBe('editor')

    const openFilesAfter = await getOpenFiles(shieldPage, worktreeId)
    expect(openFilesAfter.length).toBe(openFilesBefore.length)
    expect(openFilesAfter[0].filePath).toBe(openFilesBefore[0].filePath)
  })
})
