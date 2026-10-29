import type { Page, TestInfo } from '@stablyai/playwright-test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from './helpers/source-control-generation-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  createBranchCommit,
  createStagedCommitMessageChange,
  openChecks,
  openSourceControl,
  seedCleanBranchEmptyState,
  seedCommitMessageComposer,
  seedCreatePrComposer
} from './helpers/source-control-ai-generation'
import {
  installDelayedCommitMessageGenerator,
  installDelayedPrGenerator
} from './helpers/source-control-ai-generators'

function readLog(pathname: string): string {
  try {
    return readFileSync(pathname, 'utf8')
  } catch {
    return ''
  }
}

async function waitForPrGenerationStored(page: Page, worktreeId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((worktreeId) => {
          const records = window.__store?.getState().pullRequestGenerationRecords ?? {}
          const record = Object.values(records).find(
            (candidate) => candidate.context.worktreeId === worktreeId
          )
          return {
            status: record?.status ?? null,
            title: record?.result?.title ?? null
          }
        }, worktreeId),
      {
        timeout: 10_000,
        message: 'PR generation result was not stored before Source Control remount'
      }
    )
    .toMatchObject({
      status: 'succeeded',
      title: 'Generated PR title after switch'
    })
}

async function waitForPrGenerationHydrated(page: Page, worktreeId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((worktreeId) => {
          const records = window.__store?.getState().pullRequestGenerationRecords ?? {}
          const record = Object.values(records).find(
            (candidate) => candidate.context.worktreeId === worktreeId
          )
          return {
            status: record?.status ?? null,
            title: record?.result?.title ?? null,
            hydrated: record?.hydrated ?? null
          }
        }, worktreeId),
      {
        timeout: 10_000,
        message: 'PR generation result was not hydrated into the Source Control form'
      }
    )
    .toMatchObject({
      status: 'succeeded',
      title: 'Generated PR title after switch',
      hydrated: true
    })
}

async function waitForCommitGenerationStored(page: Page, worktreeId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((worktreeId) => {
          const records = window.__store?.getState().commitMessageGenerationRecords ?? {}
          const record = records[worktreeId]
          return {
            status: record?.status ?? null,
            message: record?.message ?? null
          }
        }, worktreeId),
      {
        timeout: 10_000,
        message: 'Commit message generation result was not stored before Source Control remount'
      }
    )
    .toMatchObject({
      status: 'succeeded',
      message: [
        'Generated commit message after switch',
        '',
        'Generated from staged e2e-commit-message-generation.txt after switching worktrees'
      ].join('\n')
    })
}

async function waitForCommitGenerationHydrated(page: Page, worktreeId: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((worktreeId) => {
          const records = window.__store?.getState().commitMessageGenerationRecords ?? {}
          const record = records[worktreeId]
          return {
            status: record?.status ?? null,
            message: record?.message ?? null,
            hydrated: record?.hydrated ?? null
          }
        }, worktreeId),
      {
        timeout: 10_000,
        message: 'Commit message generation result was not hydrated into the Source Control form'
      }
    )
    .toMatchObject({
      status: 'succeeded',
      message: [
        'Generated commit message after switch',
        '',
        'Generated from staged e2e-commit-message-generation.txt after switching worktrees'
      ].join('\n'),
      hydrated: true
    })
}

async function writeEvidence(
  testInfo: TestInfo,
  screenshotDir: string,
  filename: string,
  evidence: unknown
): Promise<void> {
  const evidencePath = path.join(screenshotDir, filename)
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  await testInfo.attach(filename, {
    path: evidencePath,
    contentType: 'application/json'
  })
}

test.describe('Source Control AI PR generation worktree switching', () => {
  test.describe.configure({ mode: 'serial' })

  test('keeps checks-panel PR generation running after switching worktrees', async ({
    shieldPage
  }, testInfo) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    const { primaryWorktreeId, prWorktreeId, prWorktreePath, primaryBranch } =
      await seedCreatePrComposer(shieldPage)
    createBranchCommit(prWorktreePath)

    const screenshotDir = path.join(
      process.cwd(),
      'validation-screenshots',
      `checks-pr-generation-switch-${Date.now()}`
    )
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })
    const generatorScriptPath = path.join(screenshotDir, 'delayed-checks-pr-generator.cjs')
    const callLogPath = path.join(screenshotDir, 'delayed-checks-pr-generator.log')
    await installDelayedPrGenerator(shieldPage, generatorScriptPath, callLogPath, primaryBranch)

    await openChecks(shieldPage, prWorktreeId)
    const generate = shieldPage.getByRole('button', {
      name: 'Generate pull request details with AI'
    })
    await expect(generate).toBeVisible({ timeout: 10_000 })
    await expect(generate).toBeEnabled()
    await generate.click()
    await expect(
      shieldPage.getByRole('button', { name: 'Stop generating pull request details' })
    ).toBeVisible()
    await expect.poll(() => readLog(callLogPath)).toContain('start')
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '01-checks-pr-generation-pending-on-a.png')
    })

    await openChecks(shieldPage, primaryWorktreeId)
    await expect(shieldPage.getByText('Generated PR title after switch')).toHaveCount(0)
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '02-checks-switched-to-b-no-generated-fields.png')
    })

    await expect.poll(() => readLog(callLogPath), { timeout: 10_000 }).toContain('finish')
    await openChecks(shieldPage, prWorktreeId)
    await expect(shieldPage.getByRole('textbox', { name: 'Pull request title' })).toHaveValue(
      'Generated PR title after switch',
      { timeout: 10_000 }
    )
    await expect(shieldPage.getByRole('textbox', { name: 'Pull request description' })).toHaveValue(
      'Generated PR body after switch'
    )
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '03-checks-returned-to-a-generated-fields.png')
    })
    await writeEvidence(testInfo, screenshotDir, 'checks-pr-generation-switch-evidence.json', {
      expectedOriginalWorktreeId: prWorktreeId,
      expectedOtherWorktreeId: primaryWorktreeId,
      generatorLog: readLog(callLogPath)
    })
  })

  test('keeps pending PR generation attached to its original worktree', async ({
    shieldPage
  }, testInfo) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    const { primaryWorktreeId, prWorktreeId, prWorktreePath, primaryBranch } =
      await seedCreatePrComposer(shieldPage)
    createBranchCommit(prWorktreePath)

    const screenshotDir = path.join(
      process.cwd(),
      'validation-screenshots',
      `pr-generation-switch-${Date.now()}`
    )
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })
    const generatorScriptPath = path.join(screenshotDir, 'delayed-pr-generator.cjs')
    const callLogPath = path.join(screenshotDir, 'delayed-pr-generator.log')
    await installDelayedPrGenerator(shieldPage, generatorScriptPath, callLogPath, primaryBranch)

    await openSourceControl(shieldPage, prWorktreeId)
    const generate = shieldPage.getByRole('button', {
      name: 'Generate pull request details with AI'
    })
    await expect(generate).toBeVisible({ timeout: 10_000 })
    await expect(generate).toBeEnabled()
    await generate.click()
    await expect(
      shieldPage.getByRole('button', { name: 'Stop generating pull request details' })
    ).toBeVisible()
    await expect
      .poll(() => {
        return readLog(callLogPath)
      })
      .toContain('start')
    const pendingEvidence = await shieldPage.evaluate(() => {
      const state = window.__store?.getState()
      return {
        activeWorktreeId: state?.activeWorktreeId,
        rightSidebarTab: state?.rightSidebarTab
      }
    })
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '01-pr-generation-pending-on-a.png')
    })

    await openSourceControl(shieldPage, primaryWorktreeId)
    await expect(shieldPage.getByText('Generated PR title after switch')).toHaveCount(0)
    const switchedEvidence = await shieldPage.evaluate(() => {
      const state = window.__store?.getState()
      return {
        activeWorktreeId: state?.activeWorktreeId,
        visibleGeneratedTitle: document.body.textContent?.includes(
          'Generated PR title after switch'
        )
      }
    })
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '02-switched-to-b-no-generated-fields.png')
    })

    await expect
      .poll(() => readFileSync(callLogPath, 'utf8'), { timeout: 10_000 })
      .toContain('finish')
    await waitForPrGenerationStored(shieldPage, prWorktreeId)
    await openSourceControl(shieldPage, prWorktreeId)
    await waitForPrGenerationHydrated(shieldPage, prWorktreeId)
    await expect(shieldPage.getByRole('textbox', { name: 'Pull request title' })).toHaveValue(
      'Generated PR title after switch',
      { timeout: 10_000 }
    )
    await expect(shieldPage.getByRole('textbox', { name: 'Pull request description' })).toHaveValue(
      'Generated PR body after switch'
    )
    const finalEvidence = await shieldPage.evaluate(() => {
      const state = window.__store?.getState()
      return {
        activeWorktreeId: state?.activeWorktreeId,
        title: (document.querySelector('[aria-label="Pull request title"]') as HTMLInputElement)
          ?.value,
        body: (
          document.querySelector('[aria-label="Pull request description"]') as HTMLTextAreaElement
        )?.value
      }
    })
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '03-returned-to-a-generated-fields.png')
    })
    await writeEvidence(testInfo, screenshotDir, 'pr-generation-evidence.json', {
      expectedOriginalWorktreeId: prWorktreeId,
      expectedOtherWorktreeId: primaryWorktreeId,
      generatorLog: readLog(callLogPath),
      pending: pendingEvidence,
      switchedAway: switchedEvidence,
      returned: finalEvidence
    })
  })

  test('hydrates pending PR generation after Source Control remounts', async ({
    shieldPage
  }, testInfo) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    const { prWorktreeId, prWorktreePath, primaryBranch } = await seedCreatePrComposer(shieldPage)
    createBranchCommit(prWorktreePath)

    const screenshotDir = path.join(
      process.cwd(),
      'validation-screenshots',
      `pr-generation-remount-${Date.now()}`
    )
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })
    const generatorScriptPath = path.join(screenshotDir, 'delayed-pr-generator.cjs')
    const callLogPath = path.join(screenshotDir, 'delayed-pr-generator.log')
    await installDelayedPrGenerator(shieldPage, generatorScriptPath, callLogPath, primaryBranch)

    await openSourceControl(shieldPage, prWorktreeId)
    const generate = shieldPage.getByRole('button', {
      name: 'Generate pull request details with AI'
    })
    await expect(generate).toBeVisible({ timeout: 10_000 })
    await expect(generate).toBeEnabled()
    await generate.click()
    await expect(
      shieldPage.getByRole('button', { name: 'Stop generating pull request details' })
    ).toBeVisible()
    await expect.poll(() => readLog(callLogPath)).toContain('start')

    await shieldPage.evaluate(() => {
      window.__store?.getState().setRightSidebarTab('explorer')
    })
    await expect(
      shieldPage.getByRole('button', { name: 'Stop generating pull request details' })
    ).toHaveCount(0)
    await expect
      .poll(() => readFileSync(callLogPath, 'utf8'), { timeout: 10_000 })
      .toContain('finish')
    await waitForPrGenerationStored(shieldPage, prWorktreeId)

    await openSourceControl(shieldPage, prWorktreeId)
    await waitForPrGenerationHydrated(shieldPage, prWorktreeId)
    await expect(shieldPage.getByRole('textbox', { name: 'Pull request title' })).toHaveValue(
      'Generated PR title after switch',
      { timeout: 10_000 }
    )
    await expect(shieldPage.getByRole('textbox', { name: 'Pull request description' })).toHaveValue(
      'Generated PR body after switch'
    )
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '01-remounted-source-control-hydrated-pr-fields.png')
    })
    await writeEvidence(testInfo, screenshotDir, 'pr-generation-remount-evidence.json', {
      expectedOriginalWorktreeId: prWorktreeId,
      generatorLog: readLog(callLogPath)
    })
  })

  test('keeps pending commit message generation attached to its original worktree', async ({
    shieldPage
  }, testInfo) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    const { primaryWorktreeId, commitWorktreeId, commitWorktreePath } =
      await seedCommitMessageComposer(shieldPage)
    createStagedCommitMessageChange(commitWorktreePath)

    const screenshotDir = path.join(
      process.cwd(),
      'validation-screenshots',
      `commit-message-generation-switch-${Date.now()}`
    )
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })
    const generatorScriptPath = path.join(screenshotDir, 'delayed-commit-generator.cjs')
    const callLogPath = path.join(screenshotDir, 'delayed-commit-generator.log')
    await installDelayedCommitMessageGenerator(shieldPage, generatorScriptPath, callLogPath)

    await openSourceControl(shieldPage, commitWorktreeId)
    await expect(
      shieldPage
        .getByTestId('source-control-entry')
        .getByText('e2e-commit-message-generation.txt', { exact: true })
    ).toBeVisible({ timeout: 10_000 })
    const generate = shieldPage.getByRole('button', {
      name: 'Generate commit message with AI'
    })
    await expect(generate).toBeVisible({ timeout: 10_000 })
    await expect(generate).toBeEnabled()
    await generate.click()
    await expect(
      shieldPage.getByRole('button', { name: 'Stop generating commit message' })
    ).toBeVisible()
    await expect
      .poll(() => {
        return readLog(callLogPath)
      })
      .toContain('start')
    const pendingEvidence = await shieldPage.evaluate(() => {
      const state = window.__store?.getState()
      return {
        activeWorktreeId: state?.activeWorktreeId,
        commitMessage: (
          document.querySelector('[aria-label="Commit message"]') as HTMLTextAreaElement
        )?.value
      }
    })
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '01-commit-message-generation-pending-on-a.png')
    })

    await openSourceControl(shieldPage, primaryWorktreeId)
    await expect(shieldPage.getByText('Generated commit message after switch')).toHaveCount(0)
    await expect(
      shieldPage.getByRole('button', { name: 'Stop generating commit message' })
    ).toHaveCount(0)
    const switchedEvidence = await shieldPage.evaluate(() => {
      const state = window.__store?.getState()
      return {
        activeWorktreeId: state?.activeWorktreeId,
        visibleGeneratedMessage: document.body.textContent?.includes(
          'Generated commit message after switch'
        )
      }
    })
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '02-switched-to-b-no-generated-commit-message.png')
    })

    await expect
      .poll(() => readFileSync(callLogPath, 'utf8'), { timeout: 10_000 })
      .toContain('finish')
    await waitForCommitGenerationStored(shieldPage, commitWorktreeId)
    await openSourceControl(shieldPage, commitWorktreeId)
    await waitForCommitGenerationHydrated(shieldPage, commitWorktreeId)
    await expect(shieldPage.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
      'Generated commit message after switch\n\nGenerated from staged e2e-commit-message-generation.txt after switching worktrees',
      { timeout: 10_000 }
    )
    const finalEvidence = await shieldPage.evaluate(() => {
      const state = window.__store?.getState()
      return {
        activeWorktreeId: state?.activeWorktreeId,
        commitMessage: (
          document.querySelector('[aria-label="Commit message"]') as HTMLTextAreaElement
        )?.value
      }
    })
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '03-returned-to-a-generated-commit-message.png')
    })
    await writeEvidence(testInfo, screenshotDir, 'commit-message-generation-evidence.json', {
      expectedOriginalWorktreeId: commitWorktreeId,
      expectedOtherWorktreeId: primaryWorktreeId,
      generatorLog: readLog(callLogPath),
      pending: pendingEvidence,
      switchedAway: switchedEvidence,
      returned: finalEvidence
    })
  })

  test('hydrates pending commit message generation after Source Control remounts', async ({
    shieldPage
  }, testInfo) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    const { commitWorktreeId, commitWorktreePath } = await seedCommitMessageComposer(shieldPage)
    createStagedCommitMessageChange(commitWorktreePath)

    const screenshotDir = path.join(
      process.cwd(),
      'validation-screenshots',
      `commit-message-generation-remount-${Date.now()}`
    )
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })
    const generatorScriptPath = path.join(screenshotDir, 'delayed-commit-generator.cjs')
    const callLogPath = path.join(screenshotDir, 'delayed-commit-generator.log')
    await installDelayedCommitMessageGenerator(shieldPage, generatorScriptPath, callLogPath)

    await openSourceControl(shieldPage, commitWorktreeId)
    const generate = shieldPage.getByRole('button', {
      name: 'Generate commit message with AI'
    })
    await expect(generate).toBeVisible({ timeout: 10_000 })
    await expect(generate).toBeEnabled()
    await generate.click()
    await expect(
      shieldPage.getByRole('button', { name: 'Stop generating commit message' })
    ).toBeVisible()
    await expect.poll(() => readLog(callLogPath)).toContain('start')

    await shieldPage.evaluate(() => {
      window.__store?.getState().setRightSidebarTab('explorer')
    })
    await expect(
      shieldPage.getByRole('button', { name: 'Stop generating commit message' })
    ).toHaveCount(0)
    await expect
      .poll(() => readFileSync(callLogPath, 'utf8'), { timeout: 10_000 })
      .toContain('finish')
    await waitForCommitGenerationStored(shieldPage, commitWorktreeId)

    await openSourceControl(shieldPage, commitWorktreeId)
    await waitForCommitGenerationHydrated(shieldPage, commitWorktreeId)
    await expect(shieldPage.getByRole('textbox', { name: 'Commit message' })).toHaveValue(
      [
        'Generated commit message after switch',
        '',
        'Generated from staged e2e-commit-message-generation.txt after switching worktrees'
      ].join('\n'),
      { timeout: 10_000 }
    )
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '01-remounted-source-control-hydrated-message.png')
    })
    await writeEvidence(
      testInfo,
      screenshotDir,
      'commit-message-generation-remount-evidence.json',
      {
        expectedOriginalWorktreeId: commitWorktreeId,
        generatorLog: readLog(callLogPath)
      }
    )
  })

  test('hides the commit AI composer on a clean branch empty state', async ({
    shieldPage
  }, testInfo) => {
    await waitForSessionReady(shieldPage)
    await waitForActiveWorktree(shieldPage)
    const primaryWorktreeId = await seedCleanBranchEmptyState(shieldPage)

    const screenshotDir = path.join(
      process.cwd(),
      'validation-screenshots',
      `clean-empty-state-${Date.now()}`
    )
    mkdirSync(screenshotDir, { recursive: true })
    await testInfo.attach('validation-screenshot-dir', {
      body: screenshotDir,
      contentType: 'text/plain'
    })

    await openSourceControl(shieldPage, primaryWorktreeId)
    await expect
      .poll(
        async () => {
          // Keep DOM assertions inside the reseeded poll because other workers’ real status refreshes share this E2E repo.
          await seedCleanBranchEmptyState(shieldPage, primaryWorktreeId)
          return shieldPage.evaluate(() => {
            const emptyStateVisible =
              document.body.textContent?.includes('No changes on this branch') === true
            const commitMessageInput = document.querySelector('[aria-label="Commit message"]')
            const commitAiButton = document.querySelector(
              '[aria-label="Generate commit message with AI"]'
            )
            return {
              emptyStateVisible,
              hasCommitMessageInput: commitMessageInput !== null,
              hasCommitAiButton: commitAiButton !== null
            }
          })
        },
        {
          timeout: 10_000,
          message: 'Clean branch empty state did not render without the commit AI composer'
        }
      )
      .toEqual({
        emptyStateVisible: true,
        hasCommitMessageInput: false,
        hasCommitAiButton: false
      })
    await seedCleanBranchEmptyState(shieldPage, primaryWorktreeId)
    await shieldPage.screenshot({
      path: path.join(screenshotDir, '01-clean-branch-no-commit-ai-composer.png')
    })
  })
})
