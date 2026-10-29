import { cpSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import {
  OCTOPOD_MOBILE_WEB_DIR,
  OCTOPOD_MOBILE_WEB_MANIFEST,
  octopodMobileWebAssetFilenames
} from '../../src/shared/octopod-artifacts.ts'

const { MOBILE_WEB_BUNDLE_DIR, assertMobileWebBundleBuilt } = createRequire(import.meta.url)(
  './verify-packaged-mobile-web-bundle.cjs'
)
const { assertNoDarkOutputOfOffSwitches } = createRequire(import.meta.url)(
  '../dark-build-switches.cjs'
)

// Require a fresh built page as beforePack does: an octopod package without it cannot serve phones.
export function stageOctopodMobileWebBundle(outputDir, bundleDir = MOBILE_WEB_BUNDLE_DIR) {
  // The release template refuses the variable itself.
  assertNoDarkOutputOfOffSwitches([bundleDir])
  assertMobileWebBundleBuilt(bundleDir)
  // The guard refuses unlisted files, so the tree is the manifest, its assets and a dark marker.
  cpSync(bundleDir, join(outputDir, ...OCTOPOD_MOBILE_WEB_DIR.split('/')), { recursive: true })
}

export function readOctopodMobileWebAssetFilenames(packageDir) {
  return octopodMobileWebAssetFilenames(
    readFileSync(join(packageDir, ...OCTOPOD_MOBILE_WEB_MANIFEST.split('/')), 'utf8')
  )
}
