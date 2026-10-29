// Change only template build identity to model an app update bundling a newer octopod.
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  OCTOPOD_TEMPLATE_MANIFEST_FILENAME,
  OCTOPOD_VERSION
} from '../../../src/shared/octopod-artifacts'

const ENTRY = 'octopod.js'

/** Rewrites `templateDir` in place; its manifest keeps verifying. */
export function makeOctopodTemplateVariant(templateDir: string, tag: string): void {
  const entry = path.join(templateDir, ENTRY)
  appendFileSync(entry, `\n// octopod e2e template variant ${tag}\n`)
  const manifestPath = path.join(templateDir, OCTOPOD_TEMPLATE_MANIFEST_FILENAME)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.commonSha256[ENTRY] = createHash('sha256').update(readFileSync(entry)).digest('hex')
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

/** The host's activation record, read the way a client reads it. */
export function readHostOctopodActivation(exec: (command: string) => string): {
  active?: string
  previous?: string
  activeAppVersion?: string
} {
  return JSON.parse(exec('cat "$HOME/.shield-remote/octopod-active.json"'))
}

export function isOctopodFullVersion(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith(`${OCTOPOD_VERSION}+`)
}
