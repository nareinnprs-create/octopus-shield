import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { OCTOPOD_LAUNCHER_FILENAME, OCTOPOD_SERVER_ENTRY_FILENAME } from './octopod-artifacts'

export const OCTOPOD_BUILD_HASH_LENGTH = 16

/** The launcher embeds its server digest, keeping the hash older clients calculate. */
export function hashOctopodLauncher(entryPath: string): string {
  const entry = realpathSync(entryPath)
  const launcher =
    basename(entry) === OCTOPOD_SERVER_ENTRY_FILENAME
      ? join(dirname(entry), OCTOPOD_LAUNCHER_FILENAME)
      : entry
  return createHash('sha256')
    .update(readFileSync(launcher))
    .digest('hex')
    .slice(0, OCTOPOD_BUILD_HASH_LENGTH)
}
