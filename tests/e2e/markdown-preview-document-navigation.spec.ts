import path from 'node:path'
import { test, expect } from './helpers/shield-app'
import {
  cleanupMarkdownFixture,
  createMarkdownFixture,
  getActiveWorktreeContext
} from './helpers/markdown-editor-fixture'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const FIXTURE_DIRECTORY = 'shield-e2e-preview-document-navigation'

for (const kind of ['relative', 'wiki'] as const) {
  for (const anchored of [false, true]) {
    test(`${kind} ${anchored ? 'anchored' : 'plain'} links stay in Markdown preview`, async ({
      shieldPage
    }, testInfo) => {
      await waitForSessionReady(shieldPage)
      await waitForActiveWorktree(shieldPage)
      const context = await getActiveWorktreeContext(shieldPage)
      let sourcePath: string | null = null
      let targetPath: string | null = null

      try {
        targetPath = await createMarkdownFixture(
          context,
          FIXTURE_DIRECTORY,
          'target',
          testInfo.workerIndex,
          '# Target\n\nDestination content.\n'
        )
        const fragment = anchored ? '#target' : ''
        const relativeTarget = path.relative(context.rootPath, targetPath).split(path.sep).join('/')
        const link =
          kind === 'wiki'
            ? `[[${relativeTarget}${fragment}|Open target]]`
            : `[Open target](${path.basename(targetPath)}${fragment})`
        sourcePath = await createMarkdownFixture(
          context,
          FIXTURE_DIRECTORY,
          'source',
          testInfo.workerIndex,
          `# Source\n\n${link}\n`
        )
        await shieldPage.evaluate(
          ({ filePath, relativePath, worktreeId }) => {
            window.__store!.getState().openMarkdownPreview({
              filePath,
              relativePath,
              worktreeId,
              language: 'markdown'
            })
          },
          {
            filePath: sourcePath,
            relativePath: path.relative(context.rootPath, sourcePath),
            worktreeId: context.worktreeId
          }
        )
        const linkElement = shieldPage.getByRole('link', { name: 'Open target', exact: true })
        await expect(linkElement).toBeVisible()
        if (kind === 'wiki') {
          await expect(linkElement).not.toHaveClass(/markdown-doc-link-broken/)
        }
        await linkElement.click()

        await expect
          .poll(() =>
            shieldPage.evaluate(() => {
              const state = window.__store!.getState()
              const file = state.openFiles.find((entry) => entry.id === state.activeFileId)
              return file
                ? {
                    filePath: file.filePath,
                    mode: file.mode,
                    anchor: file.markdownPreviewAnchor ?? null
                  }
                : null
            })
          )
          .toEqual({
            filePath: targetPath,
            mode: 'markdown-preview',
            anchor: anchored ? 'target' : null
          })
        await expect(shieldPage.getByRole('heading', { name: 'Target', exact: true })).toBeVisible()
        const screenshotPath = testInfo.outputPath('destination-preview.png')
        await shieldPage.screenshot({ path: screenshotPath })
        await testInfo.attach('destination-preview', {
          path: screenshotPath,
          contentType: 'image/png'
        })
      } finally {
        await cleanupMarkdownFixture(sourcePath)
        await cleanupMarkdownFixture(targetPath)
      }
    })
  }
}
