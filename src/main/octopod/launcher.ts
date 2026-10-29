import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { OCTOPOD_SERVER_ENTRY_FILENAME } from '../../shared/octopod-artifacts'
import { assertOctopodServerRuntime, handoffToBundledOctopod } from './octopod-bundled-runtime'
import { OCTOPOD_EXIT_CONFIGURATION } from './octopod-configuration-exit'
import { enableManagedOctopodCompileCache } from './octopod-compile-cache'

declare const OCTOPOD_SERVER_SHA256: string

let loadServer: (() => void) | undefined

try {
  if (!handoffToBundledOctopod()) {
    assertOctopodServerRuntime()
    const entry = realpathSync(process.argv[1] ?? __filename)
    const server = join(dirname(entry), OCTOPOD_SERVER_ENTRY_FILENAME)
    if (createHash('sha256').update(readFileSync(server)).digest('hex') !== OCTOPOD_SERVER_SHA256) {
      throw new Error('The Shield server does not match its launcher')
    }
    loadServer = () => {
      enableManagedOctopodCompileCache(dirname(entry))
      createRequire(entry)(server)
    }
  }
} catch (error) {
  console.error('octopod: failed to launch:', error)
  process.exit(OCTOPOD_EXIT_CONFIGURATION)
}

loadServer?.()
