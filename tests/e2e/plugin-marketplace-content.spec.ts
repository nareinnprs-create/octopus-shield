// Use production Git paths from a fresh profile for official marketplace discovery and Phase 1 language/VM/keybinding setup.

import { execFile } from 'node:child_process'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from '@stablyai/playwright-test'
import { createRestartSession } from './helpers/shield-restart'

const execFileAsync = promisify(execFile)

type MarketplaceFixture = {
  root: string
  home: string
  gitEnvironment: Record<string, string>
}

function isolatedGitProcessEnv(gitEnvironment: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_'))),
    ...gitEnvironment
  }
}

async function runGit(
  cwd: string,
  args: string[],
  gitEnvironment: Record<string, string>
): Promise<void> {
  await execFileAsync('git', args, { cwd, env: isolatedGitProcessEnv(gitEnvironment) })
}

async function commitRepository(
  repository: string,
  gitEnvironment: Record<string, string>
): Promise<void> {
  await runGit(repository, ['init', '--quiet'], gitEnvironment)
  await runGit(repository, ['checkout', '--quiet', '-b', 'main'], gitEnvironment)
  await runGit(repository, ['add', '--all'], gitEnvironment)
  await runGit(
    repository,
    [
      '-c',
      'user.name=Shield Test',
      '-c',
      'user.email=shield-test@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture'
    ],
    gitEnvironment
  )
  await runGit(repository, ['tag', 'v1.0.0'], gitEnvironment)
}

async function copyLaunchPlugin(
  repositories: string,
  repositoryName: string,
  launchDirectory: string,
  gitEnvironment: Record<string, string>
): Promise<void> {
  const repository = join(repositories, `${repositoryName}.git`)
  await cp(join(process.cwd(), 'resources', 'plugins', 'launch', launchDirectory), repository, {
    recursive: true
  })
  await commitRepository(repository, gitEnvironment)
}

async function configureFixtureGit(
  home: string,
  repositories: string
): Promise<Record<string, string>> {
  const hooksDirectory = join(home, 'hooks')
  const configPath = join(home, '.gitconfig')
  await mkdir(hooksDirectory, { recursive: true })
  const gitEnvironment: Record<string, string> = {
    GIT_CONFIG_GLOBAL: configPath,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0'
  }
  const repositoryBaseUrl = pathToFileURL(`${repositories}${sep}`).href
  const entries = [
    [`url.${repositoryBaseUrl}.insteadOf`, 'https://github.com/octopusshield/'],
    ['protocol.file.allow', 'always'],
    ['commit.gpgSign', 'false'],
    ['tag.gpgSign', 'false'],
    ['core.hooksPath', hooksDirectory]
  ] as const
  for (const [key, value] of entries) {
    await runGit(home, ['config', '--file', configPath, key, value], gitEnvironment)
  }
  return gitEnvironment
}

async function createMarketplaceFixture(): Promise<MarketplaceFixture> {
  const root = await mkdtemp(join(tmpdir(), 'shield-marketplace-e2e-'))
  const repositories = join(root, 'repositories')
  const home = join(root, 'home')
  await mkdir(repositories, { recursive: true })
  await mkdir(home, { recursive: true })
  const gitEnvironment = await configureFixtureGit(home, repositories)
  await copyLaunchPlugin(
    repositories,
    'shield-portuguese',
    'octopusshield.shield-portuguese',
    gitEnvironment
  )
  await copyLaunchPlugin(
    repositories,
    'shield-multipass-recipes',
    'octopusshield.shield-multipass-recipes',
    gitEnvironment
  )
  await copyLaunchPlugin(
    repositories,
    'shield-navigation-shortcuts',
    'octopusshield.shield-navigation-shortcuts',
    gitEnvironment
  )

  const marketplaceRepository = join(repositories, 'shield-plugins.git')
  await mkdir(marketplaceRepository, { recursive: true })
  await writeFile(
    join(marketplaceRepository, 'shield-marketplace.json'),
    `${JSON.stringify(
      {
        name: 'Shield Plugins',
        owner: 'octopusshield',
        plugins: [
          ['octopusshield.shield-portuguese', 'shield-portuguese', 'languages'],
          ['octopusshield.shield-multipass-recipes', 'shield-multipass-recipes', 'vm-recipes'],
          ['octopusshield.shield-navigation-shortcuts', 'shield-navigation-shortcuts', 'keybindings']
        ].map(([id, repository, category]) => ({
          id,
          source: {
            kind: 'git',
            url: `https://github.com/octopusshield/${repository}.git`,
            ref: 'v1.0.0'
          },
          categories: [category]
        }))
      },
      null,
      2
    )}\n`
  )
  await commitRepository(marketplaceRepository, gitEnvironment)

  return {
    root,
    home,
    gitEnvironment
  }
}

async function openPluginSettings(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'plugins', repoId: null })
    state.openSettingsPage()
  })
  await expect(page.locator('[data-settings-section="plugins"]')).toBeVisible()
}

async function installMarketplacePluginThroughUi(
  page: Page,
  pluginKey: string,
  pluginName: string,
  consentDialogName: string
): Promise<void> {
  const listing = page.locator(`[data-marketplace-plugin-key="${pluginKey}"]`)
  await expect(listing).toBeVisible()
  await listing.getByRole('button', { name: 'Install' }).click()
  const preview = page.getByRole('dialog', { name: pluginName })
  await expect(preview).toContainText('Official · octopusshield')
  await preview.getByRole('button', { name: 'Install plugin' }).click()
  const consent = page.getByRole('dialog', { name: consentDialogName })
  await expect(consent).toBeVisible()
  await consent.getByRole('button', { name: 'Enable plugin' }).click()
  await expect(consent).toBeHidden()
}

async function enableInstalledPluginThroughUi(
  page: Page,
  pluginKey: string,
  consentDialogName: string
): Promise<void> {
  await page.getByRole('tab', { name: /^Installed/ }).click()
  const plugin = page.locator(`[data-plugin-key="${pluginKey}"]`)
  await expect(plugin).toBeVisible()
  await plugin.getByRole('button', { name: 'Review & enable' }).click()
  const consent = page.getByRole('dialog', { name: consentDialogName })
  await expect(consent).toBeVisible()
  await consent.getByRole('button', { name: 'Enable plugin' }).click()
  await expect(consent).toBeHidden()
}

async function applyInstalledLanguage(page: Page): Promise<void> {
  const languageId = 'plugin:octopusshield.shield-portuguese/pt-BR'
  await page.evaluate(() => {
    const state = window.__store?.getState()
    if (!state) {
      throw new Error('store unavailable')
    }
    state.openSettingsTarget({ pane: 'appearance', repoId: null })
  })
  await expect(page.locator('[data-settings-section="appearance"]')).toBeVisible()
  await page.evaluate(() => window.__store?.setState({ settingsSearchQuery: 'Language' }))
  await page.getByRole('combobox', { name: 'Language' }).click()
  await page.getByRole('option', { name: 'pt-BR — octopusshield.shield-portuguese', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => window.__store?.getState().settings?.uiLanguage))
    .toBe(languageId)
}

async function runMarketplaceJourney(page: Page): Promise<void> {
  const startedAt = Date.now()
  await openPluginSettings(page)
  const pluginSystem = page.getByRole('switch', { name: 'Plugin system' })
  await pluginSystem.click()
  await expect(pluginSystem).toBeChecked()
  await expect
    .poll(
      () =>
        page.evaluate(async () => ({
          sources: await window.api.plugins.listMarketplaces(),
          listings: await window.api.plugins.listMarketplacePlugins()
        })),
      { timeout: 30_000 }
    )
    .toMatchObject({
      sources: [expect.objectContaining({ official: true, stale: false })],
      listings: expect.arrayContaining([
        expect.objectContaining({ pluginKey: 'octopusshield.shield-portuguese', official: true }),
        expect.objectContaining({ pluginKey: 'octopusshield.shield-multipass-recipes', official: true }),
        expect.objectContaining({
          pluginKey: 'octopusshield.shield-navigation-shortcuts',
          official: true
        })
      ])
    })

  await installMarketplacePluginThroughUi(
    page,
    'octopusshield.shield-portuguese',
    'Português do Brasil',
    'Review plugin'
  )
  await installMarketplacePluginThroughUi(
    page,
    'octopusshield.shield-multipass-recipes',
    'Multipass VM Recipes',
    'Review plugin content'
  )
  await enableInstalledPluginThroughUi(
    page,
    'octopusshield.shield-navigation-shortcuts',
    'Review plugin content'
  )

  await applyInstalledLanguage(page)
  expect(Date.now() - startedAt).toBeLessThan(120_000)
}

// oxlint-disable-next-line no-empty-pattern -- Playwright passes fixtures before testInfo.
test('installs and applies official Phase 1 content from a fresh profile', async ({}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = await createMarketplaceFixture()
  const session = createRestartSession(testInfo as TestInfo, fixture.gitEnvironment)
  let launched: Awaited<ReturnType<typeof session.launch>> | null = null
  try {
    launched = await session.launch()
    await runMarketplaceJourney(launched.page)
  } finally {
    if (launched) {
      await session.close(launched.app)
    }
    await session.dispose()
    await rm(fixture.root, { recursive: true, force: true })
  }
})
