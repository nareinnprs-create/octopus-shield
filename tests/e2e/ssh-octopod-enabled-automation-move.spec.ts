// #29083: an enabled SSH automation moves with its host and keeps running on the host's server.
// OSHIELD_E2E_OCTOPOD_CONVERT_HOST=docker; OSHIELD_E2E_OCTOPOD_CONVERT_TEMPLATE must be built for the Docker host.
import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/shield-app'
import { waitForSessionReady } from './helpers/store'
import { createRestartSession } from './helpers/shield-restart'
import { seedRelayEraProfile } from './helpers/octopod-upgrade-profile'
import {
  mutateStoppedProfileState,
  readPersistedProfileState
} from './helpers/persisted-profile-state'
import { openSshHostSettings } from './helpers/ssh-config-host-picker'
import { managedServer, serverCall } from './helpers/octopod-convert-flow'
import {
  OCTOPOD_CONVERT_HOST_ENV,
  startOctopodConvertHost,
  type OctopodConvertHost
} from './helpers/octopod-convert-host'

const HOST = process.env[OCTOPOD_CONVERT_HOST_ENV]
const TEMPLATE_SOURCE = process.env.OSHIELD_E2E_OCTOPOD_CONVERT_TEMPLATE
const DAY_MS = 86_400_000

test.skip(
  HOST !== 'docker' || !TEMPLATE_SOURCE,
  `Set ${OCTOPOD_CONVERT_HOST_ENV}=docker and OSHIELD_E2E_OCTOPOD_CONVERT_TEMPLATE`
)

let host: OctopodConvertHost | null = null
test.afterEach(() => {
  host?.cleanup()
  host = null
})

function seedEnabledAutomation(userDataDir: string, repoId: string, targetId: string): string {
  const now = Date.now()
  const automationId = `automation-${now}`
  mutateStoppedProfileState(userDataDir, (state: Record<string, unknown>) => {
    state.automations = [
      {
        id: automationId,
        name: 'nightly check',
        prompt: 'check',
        precheck: null,
        agentId: 'claude',
        projectId: repoId,
        executionTargetType: 'ssh',
        executionTargetId: targetId,
        schedulerOwner: 'ssh_bridge',
        workspaceMode: 'new_per_run',
        workspaceId: null,
        baseBranch: null,
        reuseSession: false,
        timezone: 'UTC',
        rrule: 'FREQ=DAILY',
        dtstart: now - 2 * DAY_MS,
        enabled: true,
        nextRunAt: now + DAY_MS,
        missedRunPolicy: 'run_once_within_grace',
        missedRunGraceMinutes: 60,
        createdAt: now - 2 * DAY_MS,
        updatedAt: now - 2 * DAY_MS
      }
    ]
    state.automationRuns = [1, 2].map((n) => ({
      id: `${automationId}-run-${n}`,
      automationId,
      title: `run ${n}`,
      scheduledFor: now - n * 3_600_000,
      status: 'completed',
      trigger: 'scheduled',
      workspaceId: null,
      sessionKind: 'terminal',
      chatSessionId: null,
      terminalSessionId: null,
      terminalPaneKey: null,
      terminalPtyId: null,
      outputSnapshot: null,
      precheckResult: null,
      usage: null,
      error: null,
      startedAt: now - n * 3_600_000,
      dispatchedAt: now - n * 3_600_000,
      createdAt: now - n * 3_600_000,
      runNumber: n
    }))
  })
  return automationId
}

type ServerAutomation = { id: string; enabled: boolean; nextRunAt: number }

test('an enabled SSH automation moves to the host server and stays on there', async ({
  testRepoPath
}, testInfo) => {
  // Starts a Docker host and two app launches, then converts the host.
  test.setTimeout(10 * 60_000)
  host = startOctopodConvertHost('docker', testInfo)
  const session = createRestartSession(testInfo, { OSHIELD_OCTOPOD_TEMPLATE_PATH: TEMPLATE_SOURCE! })
  let app: ElectronApplication | null = null
  try {
    const first = await session.launch()
    app = first.app
    await waitForSessionReady(first.page)
    await first.page.evaluate((repoPath) => window.api.repos.add({ path: repoPath }), testRepoPath)
    await session.close(app)
    app = null
    const seeded = seedRelayEraProfile(session.userDataDir, host.input, {
      repoPath: host.remoteRepoPath,
      folderPath: host.remoteFolderPath
    })
    const automationId = seedEnabledAutomation(session.userDataDir, seeded.repoId, seeded.targetId)
    const upgraded = await session.launch()
    app = upgraded.app
    const page = upgraded.page
    await waitForSessionReady(page)
    const section = await openSshHostSettings(page)
    const card = section.locator(
      `[data-ssh-target-card][data-ssh-target-label="${host.input.label}"]`
    )
    await card.hover()
    await card.getByRole('button', { name: 'Connect', exact: true }).click()
    await expect
      .poll(() => managedServer(page, seeded.targetId), { timeout: 4 * 60_000 })
      .toMatchObject({ kind: 'managed' })
    await expect(card).toContainText('Connected', { timeout: 30_000 })
    await expect(card).not.toContainText('cannot move yet')
    await page.screenshot({ path: testInfo.outputPath('moved.png') })

    const environmentId = await page.evaluate((id) => {
      const server = window.__store?.getState().sshConnectionStates.get(id)?.managedServer
      return server?.kind === 'managed' ? server.environmentId : null
    }, seeded.targetId)
    if (!environmentId) {
      throw new Error('The host connected without a managed server')
    }
    const automations: ServerAutomation[] = JSON.parse(
      await serverCall(page, environmentId, 'automation.list')
    ).result.automations
    const moved = automations.find((entry) => entry.id === automationId)
    expect(moved?.enabled).toBe(true)
    expect(moved?.nextRunAt).toBeGreaterThan(Date.now())
    const runs: unknown[] = JSON.parse(
      await serverCall(page, environmentId, 'automation.runs', { automationId })
    ).result.runs
    expect(runs).toHaveLength(2)

    await session.close(app)
    app = null
    const desktop = readPersistedProfileState(session.userDataDir).automations
    expect(desktop).toEqual([expect.objectContaining({ id: automationId, enabled: false })])
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
  }
})
