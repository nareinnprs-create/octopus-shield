import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const GARDENS_DIR_ENV = 'OSHIELD_GARDENS_VM_DIR'

export const gardensVmDirFromEnv = (env: Readonly<Record<string, string | undefined>>): string =>
  env[GARDENS_DIR_ENV] ?? join(tmpdir(), 'oshield', 'gardens-vm')
