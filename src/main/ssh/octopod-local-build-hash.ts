import { join } from 'node:path'
import { hashOctopodLauncher } from '../../shared/octopod-build-identity'
import { OCTOPOD_LAUNCHER_FILENAME } from '../../shared/octopod-artifacts'

export function computeLocalOctopodBuildHash(localOctopodDir: string): string {
  return hashOctopodLauncher(join(localOctopodDir, OCTOPOD_LAUNCHER_FILENAME))
}
