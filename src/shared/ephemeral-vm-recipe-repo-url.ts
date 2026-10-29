import { stripCredentialsFromMessage } from './git-remote-error'
import type { ShieldVmRecipe } from './shield-yaml-hook-types'

export function getProvisionedRootRecipeRepoUrl(
  checkoutMode: ShieldVmRecipe['checkoutMode'],
  remoteUrl: string | undefined
): string | undefined {
  if (checkoutMode !== 'provisioned-root' || !remoteUrl) {
    return undefined
  }
  return stripCredentialsFromMessage(remoteUrl)
}
