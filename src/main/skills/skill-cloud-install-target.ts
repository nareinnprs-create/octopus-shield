import type { SkillInstallDestination } from '../../shared/skill-install-contract'
import type { ShieldRuntimeService } from '../runtime/shield-runtime'

export async function classifySkillCloudInstallTarget(
  runtime: ShieldRuntimeService,
  input: { environmentId?: string; destination: SkillInstallDestination }
): Promise<'local' | 'remote'> {
  return input.environmentId || (await runtime.skillInstallDestinationUsesSsh(input.destination))
    ? 'remote'
    : 'local'
}
