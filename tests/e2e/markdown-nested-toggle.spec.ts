import { readFileSync } from 'node:fs'
import { test, expect } from './helpers/shield-app'
import {
  cleanupMarkdownFixture,
  closeActiveEditorTab,
  createMarkdownFixture,
  getActiveWorktreeContext,
  openMarkdownFixture,
  waitForRichMarkdownEditor
} from './helpers/markdown-editor-fixture'
import {
  expectEditableNestedToggles,
  expectFileKeepsNesting,
  expectPassthroughFallback,
  expectSentinelInsideNestedToggle,
  NESTED_TOGGLE_FIXTURE_DIRECTORY,
  NESTED_TOGGLE_MARKDOWN,
  placeCaretInNestedToggleBody,
  UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
} from './helpers/markdown-nested-toggle'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

test.describe('Markdown nested toggle regression', () => {
  test.beforeEach(async ({ shieldPage }) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
  })

  test('a plain details block opens as an editable toggle', async ({ shieldPage }, testInfo) => {
    const context = await getActiveWorktreeContext(shieldPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'plain-details',
        testInfo.workerIndex,
        '<details>\n<summary>Toggle</summary>\n\nBody\n\n</details>\n'
      )
      await openMarkdownFixture(shieldPage, context, filePath)
      const editor = await waitForRichMarkdownEditor(shieldPage)
      const toggle = editor.locator('[data-type="details"]')

      await expect(toggle).toHaveCount(1)
      await expect(toggle.locator('summary')).toHaveText('Toggle')
      await expect(editor.locator('[data-raw-markdown-html-block]')).toHaveCount(0)
      const screenshotPath = testInfo.outputPath('plain-details-rich-editor.png')
      await shieldPage.screenshot({ path: screenshotPath })
      await testInfo.attach('plain-details-rich-editor', {
        path: screenshotPath,
        contentType: 'image/png'
      })
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('a nested toggle on disk reopens as editable toggles', async ({ shieldPage }, testInfo) => {
    const context = await getActiveWorktreeContext(shieldPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-reopen',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(shieldPage, context, filePath)
      await waitForRichMarkdownEditor(shieldPage)

      await expectEditableNestedToggles(shieldPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('editing a nested toggle survives save and reopen', async ({ shieldPage }, testInfo) => {
    const context = await getActiveWorktreeContext(shieldPage)
    const sentinel = `editedInsideNestedToggle${Date.now()}`
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-edit',
        testInfo.workerIndex,
        NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(shieldPage, context, filePath)
      await waitForRichMarkdownEditor(shieldPage)
      await expectEditableNestedToggles(shieldPage)

      await placeCaretInNestedToggleBody(shieldPage)
      await shieldPage.keyboard.type(` ${sentinel}`)
      await expectSentinelInsideNestedToggle(shieldPage, sentinel)

      // Save through the real shortcut and assert the bytes that landed on disk.
      await shieldPage.keyboard.press('ControlOrMeta+S')
      const savedPath = filePath
      await expect
        .poll(() => readFileSync(savedPath, 'utf8'), { timeout: 10_000 })
        .toContain(sentinel)
      expectFileKeepsNesting(readFileSync(savedPath, 'utf8'), sentinel)

      // Reopen the saved bytes from scratch; the reported bug appeared only after reparsing.
      await closeActiveEditorTab(shieldPage, savedPath)
      await openMarkdownFixture(shieldPage, context, savedPath)
      await waitForRichMarkdownEditor(shieldPage)
      await expectEditableNestedToggles(shieldPage)
      await expectSentinelInsideNestedToggle(shieldPage, sentinel)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })

  test('a nested toggle that cannot be represented stays raw passthrough', async ({
    shieldPage
  }, testInfo) => {
    const context = await getActiveWorktreeContext(shieldPage)
    let filePath: string | null = null

    try {
      filePath = await createMarkdownFixture(
        context,
        NESTED_TOGGLE_FIXTURE_DIRECTORY,
        'nested-toggle-unsupported',
        testInfo.workerIndex,
        UNSUPPORTED_NESTED_TOGGLE_MARKDOWN
      )
      await openMarkdownFixture(shieldPage, context, filePath)
      await waitForRichMarkdownEditor(shieldPage)

      await expectPassthroughFallback(shieldPage)
    } finally {
      await cleanupMarkdownFixture(filePath)
    }
  })
})
