import { randomUUID } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from './helpers/shield-app'
import { getActiveWorktreeContext } from './helpers/markdown-editor-fixture'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { buildOwnedEditorFileId } from '../../src/renderer/src/store/slices/editor/file-ids/editor-file-ids'

test('keeps same-path host models and undo history separate', async ({
  shieldPage,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  const context = await getActiveWorktreeContext(shieldPage)
  const filePath = path.join(context.rootPath, `host-model-${randomUUID()}.txt`)
  await writeFile(filePath, 'LOCAL_MARKER', 'utf8')
  registerPostElectronShutdownCleanup(() => rm(filePath, { force: true }))
  const remoteId = buildOwnedEditorFileId(filePath, context.worktreeId, 'host-model-fixture')

  // Open through the user path so main owns both tabs; key the second runtime separately before redirecting its unselected tab to local transport.
  const openedIds = await shieldPage.evaluate(
    ({ filePath, worktreeId }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Editor store unavailable')
      }
      const generation = {
        runtimeConnectionGeneration: null,
        runtimePairingRevision: undefined,
        runtimeSshGeneration: null,
        nestedSshGeneration: null,
        directSshGeneration: null
      }
      const provenance = (
        executionHostId: 'local' | 'ssh:fixture-target',
        runtimeEnvironmentId: string | null
      ) => ({
        ownershipProjection: 'explicit' as const,
        generation: { ...generation, route: { executionHostId, runtimeEnvironmentId } }
      })
      const file = {
        filePath,
        relativePath: filePath.split(/[\\/]/).pop() ?? filePath,
        worktreeId,
        language: 'plaintext',
        mode: 'edit' as const
      }
      const localId = store.getState().openFile({
        ...file,
        runtimeEnvironmentId: null,
        operationProvenance: provenance('local', null)
      })
      const remoteId = store.getState().openFile(
        {
          ...file,
          runtimeEnvironmentId: 'host-model-fixture',
          operationProvenance: provenance('ssh:fixture-target', 'host-model-fixture')
        },
        { selection: 'none' }
      )
      store.getState().markFileDirty(localId, true)
      store.getState().markFileDirty(remoteId, true)
      store.setState((state) => ({
        openFiles: state.openFiles.map((entry) =>
          entry.id === remoteId
            ? {
                ...entry,
                runtimeEnvironmentId: undefined,
                operationProvenance: provenance('ssh:fixture-target', null)
              }
            : entry
        ),
        editorDrafts: {
          ...state.editorDrafts,
          [localId]: 'LOCAL_MARKER',
          [remoteId]: 'REMOTE_MARKER'
        }
      }))
      store.getState().setActiveFile(localId)
      return { localId, remoteId }
    },
    { filePath, worktreeId: context.worktreeId }
  )
  expect(openedIds).toEqual({ localId: filePath, remoteId })

  const editor = shieldPage.locator('.monaco-editor').first()
  await expect(editor).toBeVisible({ timeout: 25_000 })
  const valueTail = () => shieldPage.evaluate(() => window.__monacoEditorE2E?.snapshot().valueTail)
  await expect.poll(valueTail).toBe('LOCAL_MARKER')
  await editor.click()
  await shieldPage.keyboard.press('ControlOrMeta+End')
  await shieldPage.keyboard.type('!')
  await expect.poll(valueTail).toBe('LOCAL_MARKER!')
  await shieldPage.evaluate((id) => window.__store?.getState().setActiveFile(id), remoteId)
  await expect.poll(valueTail).toBe('REMOTE_MARKER')
  await shieldPage.screenshot({ path: testInfo.outputPath('remote-before-undo.png') })
  await editor.click()
  await shieldPage.keyboard.press('ControlOrMeta+z')
  await shieldPage.screenshot({ path: testInfo.outputPath('remote-after-undo.png') })
  await expect.poll(valueTail).toBe('REMOTE_MARKER')
  await shieldPage.keyboard.press('ControlOrMeta+End')
  await shieldPage.keyboard.type('?')
  await expect.poll(valueTail).toBe('REMOTE_MARKER?')
  await shieldPage.keyboard.press('ControlOrMeta+z')
  await expect.poll(valueTail).toBe('REMOTE_MARKER')
  await shieldPage.evaluate((id) => window.__store?.getState().setActiveFile(id), filePath)
  await expect.poll(valueTail).toBe('LOCAL_MARKER!')
  await shieldPage.screenshot({ path: testInfo.outputPath('local-retained-edit.png') })
})
