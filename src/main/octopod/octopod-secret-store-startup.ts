import { join } from 'node:path'
import { prepareOctopodSecretStore } from './octopod-host-adapters'

export async function prepareOctopodSecretStoreAndMigrate(userDataPath: string): Promise<void> {
  const { getSecretStore } = await import('../../shared/secret-store')
  const { reportSecretProtectionGap } = await import('../host/secret-protection-report')
  const { migratePlaintextCredentials, octopodCredentialRoot } =
    await import('./octopod-plaintext-credential-migration')
  // Keep sealing keys outside disposable OSHIELD_USER_DATA roots.
  if (await prepareOctopodSecretStore(octopodCredentialRoot(), userDataPath)) {
    migratePlaintextCredentials(getSecretStore())
  }
  reportSecretProtectionGap({ dataFile: join(userDataPath, 'shield-data.json') })
}
