import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import { translate } from '@/i18n/i18n'
import { translateSearchKeyword } from './settings-search-keywords'

export const getShieldAccountSettingsSearchEntries = createLocalizedCatalog(() => [
  {
    title: translate('auto.components.settings.shieldAccount.account', 'Shield account'),
    description: translate(
      'auto.components.settings.shieldAccount.searchDescription',
      'Sign in or out of the account used by Artifacts and Shield Relay.'
    ),
    keywords: [
      ...translateSearchKeyword('auto.components.settings.shieldAccount.keywordAccount', 'account'),
      ...translateSearchKeyword('auto.components.settings.shieldAccount.keywordLogin', 'login'),
      ...translateSearchKeyword('auto.components.settings.shieldAccount.keywordLogout', 'logout'),
      ...translateSearchKeyword('auto.components.settings.shieldAccount.keywordSignIn', 'sign in'),
      ...translateSearchKeyword('auto.components.settings.shieldAccount.keywordSignOut', 'sign out'),
      ...translateSearchKeyword('auto.components.settings.shieldAccount.keywordRelay', 'relay'),
      ...translateSearchKeyword('auto.components.settings.shieldAccount.keywordCloud', 'cloud')
    ]
  }
])
