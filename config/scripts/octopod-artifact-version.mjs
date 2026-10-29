import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OCTOPOD_VERSION, octopodArtifactFilenames } from '../../src/shared/octopod-artifacts.ts'
import { readOctopodMobileWebAssetFilenames } from './octopod-mobile-web-bundle.mjs'

/** The runtime enters through `.runtime-node`'s executableSha256 string, never its bytes (design D2). */
export function computeOctopodFullVersion(artifactDir, { target, agentBrowserFilename }) {
  const hash = createHash('sha256')
  for (const filename of octopodArtifactFilenames(
    target,
    readOctopodMobileWebAssetFilenames(artifactDir)
  )) {
    const artifactPath = join(artifactDir, filename)
    if (!existsSync(artifactPath)) {
      throw new Error(
        `octopod declares ${filename} in OCTOPOD_ARTIFACTS but never emitted it. Add the build ` +
          'step, or drop it from src/shared/octopod-artifacts.ts.'
      )
    }
    hash.update(readFileSync(artifactPath))
  }
  if (agentBrowserFilename && existsSync(join(artifactDir, agentBrowserFilename))) {
    hash.update(readFileSync(join(artifactDir, agentBrowserFilename)))
  }
  return `${OCTOPOD_VERSION}+${hash.digest('hex').slice(0, 12)}`
}
