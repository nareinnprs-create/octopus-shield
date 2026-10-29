import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { classifyNodeServerChanges, collectNodeServerInputs } from './node-server-change-scope.mjs'
import {
  OCTOPOD_CHILD_ENTRY_POINTS,
  OCTOPOD_ENTRY_POINT,
  OCTOPOD_LAUNCHER_ENTRY_POINT
} from './octopod-entry-build.mjs'

const ENTRY_POINTS = [
  OCTOPOD_ENTRY_POINT,
  OCTOPOD_LAUNCHER_ENTRY_POINT,
  ...Object.values(OCTOPOD_CHILD_ENTRY_POINTS),
  'src/cli/index.ts',
  'config/scripts/build-octopod-node.mjs',
  'config/scripts/build-octopod-prebuilds.mjs',
  'config/scripts/build-octopod.mjs',
  'config/scripts/ensure-native-runtime.mjs',
  'config/scripts/rebuild-native-deps.mjs',
  'config/scripts/verify-cli-bin.mjs',
  'config/scripts/install-dev-cli.mjs',
  'config/scripts/shield-dev.mjs',
  'config/scripts/runtime-serve-terminal-smoke.mjs',
  'config/scripts/octopod-terminal-smoke-change-scope.mjs'
]

export function collectOctopodTerminalSmokeInputs() {
  return collectNodeServerInputs({ entryPoints: ENTRY_POINTS })
}

export async function classifyOctopodTerminalSmokeChanges(
  changedFiles,
  collect = collectOctopodTerminalSmokeInputs
) {
  const forced = changedFiles.find(
    (file) =>
      ENTRY_POINTS.includes(file) ||
      file === '.github/workflows/pr.yml' ||
      file.startsWith('config/scripts/octopod-terminal-smoke-') ||
      file.startsWith('config/scripts/runtime-serve-terminal-smoke') ||
      // createRequire-loaded native probes are invisible to esbuild's import graph.
      (file.startsWith('config/scripts/') && file.endsWith('.cjs')) ||
      // CLI emit and runtime resources include files opened by path, outside the import graph.
      file.startsWith('src/cli/') ||
      file.startsWith('src/shared/') ||
      file.startsWith('resources/')
  )
  if (forced) {
    return { shouldRun: true, reason: `Smoke input changed: ${forced}` }
  }
  // Retain the headless-server gate's native, worker, toolchain and failed-analysis safeguards.
  return classifyNodeServerChanges(changedFiles, collect)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const changedFiles = readFileSync(process.argv[2], 'utf8').split('\0').filter(Boolean)
  const result = await classifyOctopodTerminalSmokeChanges(changedFiles)
  console.error(result.reason)
  process.stdout.write(`${result.shouldRun}\n`)
}
