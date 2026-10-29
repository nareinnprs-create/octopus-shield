import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/shield-app'
import { postClaudeHook, readHookEndpoint } from './helpers/agent-hook-endpoint'
import { SIDEBAR_INPUTS_BUILD } from './helpers/sidebar-inputs-build'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePaneHookDescriptor,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { RECENT_STAMP_THROTTLE_MS } from '../../src/shared/sidebar-list/sort-stamps'
import {
  WorkspaceRowsSnapshotSchema,
  type WorkspaceRow
} from '../../src/shared/sidebar-list/workspace-rows'

test.skip(
  !SIDEBAR_INPUTS_BUILD,
  'the host stamps sort keys only in an OSHIELD_SIDEBAR_INPUTS=main build'
)

async function readMainRow(page: Page, rowKey: string): Promise<WorkspaceRow | undefined> {
  const response = await page.evaluate(() =>
    window.api.runtime.call({ method: 'sidebarInputs.workspaceRows' })
  )
  if (!response.ok) {
    throw new Error('sidebarInputs.workspaceRows failed')
  }
  return WorkspaceRowsSnapshotSchema.parse(response.result).rows[rowKey]
}

test('the host stamps a workspace as its agent is prompted, finishes and asks for input', async ({
  shieldPage,
  electronApp
}) => {
  test.setTimeout(90_000)
  await waitForSessionReady(shieldPage)
  await waitForActiveWorktree(shieldPage)
  await ensureTerminalVisible(shieldPage)
  await waitForActiveTerminalManager(shieldPage, 30_000)
  const endpoint = await readHookEndpoint(electronApp)
  const pane = await waitForActivePaneHookDescriptor(shieldPage)
  // Wait for pane spawn and hold its foreground; spawn clears earlier hook status.
  await execInTerminal(
    shieldPage,
    await waitForActivePanePtyId(shieldPage),
    "printf 'agent-%s\\n' up; sleep 600"
  )
  await waitForTerminalOutput(shieldPage, 'agent-up', 20_000)
  const rowKey = `local|${pane.worktreeId}`
  await expect.poll(async () => (await readMainRow(shieldPage, rowKey))?.kind).toBe('git')
  const before = (await readMainRow(shieldPage, rowKey))!
  // Opening the workspace and its terminal is not activity.
  expect(before.smartTier).toBeUndefined()

  // Past the throttle, so the prompt's Recent stamp is not swallowed by the creation stamp.
  await shieldPage.waitForTimeout(
    Math.max(0, before.recentAt! + RECENT_STAMP_THROTTLE_MS - Date.now())
  )
  await postClaudeHook(endpoint, pane, { hook_event_name: 'UserPromptSubmit', prompt: 'go' })
  await expect.poll(async () => (await readMainRow(shieldPage, rowKey))?.smartTier).toBe('working')
  const prompted = (await readMainRow(shieldPage, rowKey))!
  expect(prompted.recentAt!).toBeGreaterThan(before.recentAt!)
  expect(prompted.smartAt).toBe(prompted.recentAt)

  await shieldPage.waitForTimeout(RECENT_STAMP_THROTTLE_MS + 500)
  await postClaudeHook(endpoint, pane, { hook_event_name: 'Stop', last_assistant_message: 'ok' })
  await expect.poll(async () => (await readMainRow(shieldPage, rowKey))?.smartTier).toBe('done')
  const finished = (await readMainRow(shieldPage, rowKey))!
  expect(finished.recentAt!).toBeGreaterThan(prompted.recentAt!)
  expect(finished.smartAt).toBe(finished.recentAt)

  // A new prompt then a question inside the throttle: tiers move at once, Recent holds.
  await postClaudeHook(endpoint, pane, { hook_event_name: 'UserPromptSubmit', prompt: 'more' })
  await expect.poll(async () => (await readMainRow(shieldPage, rowKey))?.smartTier).toBe('working')
  await postClaudeHook(endpoint, pane, {
    hook_event_name: 'PermissionRequest',
    tool_name: 'Bash',
    tool_input: { command: 'ls' }
  })
  await expect.poll(async () => (await readMainRow(shieldPage, rowKey))?.smartTier).toBe('needs-you')
  const asked = (await readMainRow(shieldPage, rowKey))!
  expect(asked.recentAt).toBe(finished.recentAt)
  expect(asked.smartAt!).toBeGreaterThan(finished.smartAt!)
})
