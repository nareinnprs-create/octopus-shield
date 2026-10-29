import { test, expect } from './helpers/shield-app'
import { waitForSessionReady } from './helpers/store'

test.use({ seedTestRepo: false })

test('global Auto preserves other agents’ choices and the single permission setting persists', async ({
  shieldPage
}) => {
  await waitForSessionReady(shieldPage)
  await shieldPage.getByRole('button', { name: 'Settings', exact: true }).click()
  await shieldPage.getByRole('button', { name: 'Agents', exact: true }).click()
  const permissions = shieldPage.getByRole('button', { name: 'Permissions', exact: true })
  const group = shieldPage.getByRole('group', { name: 'Permissions', exact: true })
  const others = shieldPage.getByRole('radiogroup', { name: 'Permissions for other agents' })
  const readPermissions = () =>
    shieldPage.evaluate(async () => {
      const settings = await window.api.settings.get()
      return {
        default: settings.agentPermissionDefault,
        claude: settings.agentPermissionOverrides?.claude ?? settings.agentPermissionDefault,
        codex: settings.agentPermissionOverrides?.codex ?? settings.agentPermissionDefault,
        grok: settings.agentPermissionOverrides?.grok ?? settings.agentPermissionDefault
      }
    })

  await permissions.click()
  await group.getByRole('menuitemradio', { name: /^Full access\b/ }).click()
  await expect(others).toHaveCount(0)
  await permissions.click()
  await group.getByRole('menuitemradio', { name: /^Approve for me\b/ }).click()
  await permissions.click()
  await expect(group.getByRole('menuitemradio', { name: /^Approve for me\b/ })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await group.getByRole('menuitemradio', { name: /^Approve for me\b/ }).press('Escape')
  await expect(others.getByRole('radio', { name: 'Full access', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect.poll(readPermissions).toEqual({
    default: 'auto',
    claude: 'auto',
    codex: 'auto',
    grok: 'full-access'
  })

  await others.getByRole('radio', { name: 'Own settings', exact: true }).click()
  await expect.poll(readPermissions).toEqual({
    default: 'auto',
    claude: 'auto',
    codex: 'auto',
    grok: 'own'
  })

  await shieldPage.reload()
  await shieldPage.waitForFunction(() => Boolean(window.__store))
  await waitForSessionReady(shieldPage)
  await shieldPage.getByRole('button', { name: 'Agents', exact: true }).click()
  await permissions.click()
  await expect(group.getByRole('menuitemradio', { name: /^Approve for me\b/ })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await group.getByRole('menuitemradio', { name: /^Approve for me\b/ }).press('Escape')
  await expect(others.getByRole('radio', { name: 'Own settings', exact: true })).toHaveAttribute(
    'aria-checked',
    'true'
  )
  await expect.poll(readPermissions).toEqual({
    default: 'auto',
    claude: 'auto',
    codex: 'auto',
    grok: 'own'
  })

  await permissions.click()
  await group.getByRole('menuitemradio', { name: /^Each agent's own settings\b/ }).click()
  await expect.poll(readPermissions).toEqual({
    default: 'own',
    claude: 'own',
    codex: 'own',
    grok: 'own'
  })
})
