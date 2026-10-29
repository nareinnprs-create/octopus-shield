import { existsSync } from 'node:fs'
import type * as NodeFsPromises from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { filePublicationFailures } = vi.hoisted(() => ({
  filePublicationFailures: { link: 0, replaceBeforeRename: '' }
}))
const registrationLock = vi.hoisted(() => ({
  completed: null as ((cacheRootPath: string) => void) | null,
  entered: null as ((cacheRootPath: string) => void) | null,
  pause: null as Promise<void> | null
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>()
  return {
    ...actual,
    link: async (...args: Parameters<typeof actual.link>) => {
      if (filePublicationFailures.link > 0) {
        filePublicationFailures.link -= 1
        throw Object.assign(new Error('link unsupported'), { code: 'ENOTSUP' })
      }
      return actual.link(...args)
    },
    rename: async (...args: Parameters<typeof actual.rename>) => {
      if (filePublicationFailures.replaceBeforeRename) {
        await actual.writeFile(args[0], filePublicationFailures.replaceBeforeRename, {
          mode: 0o755
        })
        filePublicationFailures.replaceBeforeRename = ''
      }
      return actual.rename(...args)
    }
  }
})

vi.mock('electron', () => ({
  app: { isPackaged: true }
}))

vi.mock('./appimage-registration-lock', () => ({
  withAppImageRegistrationLock: async <T>(
    cacheRootPath: string,
    operation: () => Promise<T>
  ): Promise<T> => {
    registrationLock.entered?.(cacheRootPath)
    const pause = registrationLock.pause
    registrationLock.pause = null
    await pause
    const result = await operation()
    registrationLock.completed?.(cacheRootPath)
    return result
  }
}))

import { installLinuxBareShieldDispatcher } from './linux-bare-shield-dispatcher'
import { resolveAppImageExtractedRoot } from './appimage-extracted-root'

const created: string[] = []

async function makeFixture(): Promise<{ homePath: string; resourcesPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'shield-bare-dispatcher-'))
  created.push(root)
  const resourcesPath = join(root, 'resources')
  await mkdir(join(resourcesPath, 'bin'), { recursive: true })
  await writeFile(join(resourcesPath, 'bin', 'shield-ide'), '#!/usr/bin/env bash\n', 'utf8')
  return { homePath: join(root, 'home'), resourcesPath }
}

afterEach(async () => {
  vi.unstubAllEnvs()
  filePublicationFailures.link = 0
  filePublicationFailures.replaceBeforeRename = ''
  registrationLock.completed = null
  registrationLock.entered = null
  registrationLock.pause = null
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('installLinuxBareShieldDispatcher', () => {
  it('uses the mounted bundled launcher when only APPDIR is inherited', async () => {
    const { homePath, resourcesPath } = await makeFixture()
    vi.stubEnv('APPIMAGE', '')
    vi.stubEnv('APPDIR', resourcesPath)

    const result = await installLinuxBareShieldDispatcher({ resourcesPath, homePath })

    expect(result.state).toBe('installed')
    expect(result.target).toBe(join(resourcesPath, 'bin', 'shield-ide'))
  })

  it('writes an executable bare-shield dispatcher that execs the bundled shield-ide launcher', async () => {
    const { homePath, resourcesPath } = await makeFixture()

    const result = await installLinuxBareShieldDispatcher({
      resourcesPath,
      homePath,
      appImagePath: null
    })

    const expectedTarget = join(resourcesPath, 'bin', 'shield-ide')
    expect(result.state).toBe('installed')
    expect(result.target).toBe(expectedTarget)
    expect(result.dispatcherPath).toBe(join(homePath, '.local', 'bin', 'shield'))

    const content = await readFile(result.dispatcherPath, 'utf8')
    expect(content).toContain('#!/usr/bin/env bash')
    // Single-quoted so a resources path with shell metacharacters can't break out.
    expect(content).toContain(`exec '${expectedTarget}' "$@"`)

    const mode = (await stat(result.dispatcherPath)).mode & 0o777
    expect(mode & 0o111).not.toBe(0)
  })

  it('is idempotent — a second install rewrites its own dispatcher without throwing', async () => {
    const { homePath, resourcesPath } = await makeFixture()

    const first = await installLinuxBareShieldDispatcher({
      resourcesPath,
      homePath,
      appImagePath: null
    })
    const second = await installLinuxBareShieldDispatcher({
      resourcesPath,
      homePath,
      appImagePath: null
    })

    expect(second).toEqual(first)
    expect(second.state).toBe('installed')
  })

  it('publishes when the home filesystem does not support hard links', async () => {
    const { homePath, resourcesPath } = await makeFixture()
    filePublicationFailures.link = 1

    const result = await installLinuxBareShieldDispatcher({
      resourcesPath,
      homePath,
      appImagePath: null
    })

    expect(result.state).toBe('installed')
    await expect(readFile(result.dispatcherPath, 'utf8')).resolves.toContain(
      '# shield-serve-bare-shield-dispatcher'
    )
  })

  it('restores a displaced foreign dispatcher when hard links are unsupported', async () => {
    const { homePath, resourcesPath } = await makeFixture()
    await installLinuxBareShieldDispatcher({ resourcesPath, homePath, appImagePath: null })
    const foreignContent = '#!/bin/sh\necho foreign\n'
    filePublicationFailures.replaceBeforeRename = foreignContent
    filePublicationFailures.link = 2

    const result = await installLinuxBareShieldDispatcher({
      resourcesPath,
      homePath,
      appImagePath: null
    })

    expect(result.state).toBe('skipped-foreign')
    await expect(readFile(result.dispatcherPath, 'utf8')).resolves.toBe(foreignContent)
  })

  it('quotes a resources path containing spaces so the exec line cannot be split', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shield-bare-dispatcher-space-'))
    created.push(root)
    const resourcesPath = join(root, 'App Support', 'resources')
    await mkdir(join(resourcesPath, 'bin'), { recursive: true })
    await writeFile(join(resourcesPath, 'bin', 'shield-ide'), '#!/usr/bin/env bash\n', 'utf8')

    const result = await installLinuxBareShieldDispatcher({
      resourcesPath,
      homePath: join(root, 'home'),
      appImagePath: null
    })

    const content = await readFile(result.dispatcherPath, 'utf8')
    expect(content).toContain(`exec '${join(resourcesPath, 'bin', 'shield-ide')}' "$@"`)
  })

  it.skipIf(process.platform === 'win32')(
    'execs the extracted payload (not the ephemeral mount) when running from an AppImage',
    async () => {
      const { homePath, resourcesPath } = await makeFixture()
      const appImagePath = join(homePath, 'Shield.AppImage')
      await mkdir(homePath, { recursive: true })
      await writeFile(appImagePath, '#!/usr/bin/env bash\n', { encoding: 'utf8', mode: 0o755 })
      const cacheRootPath = join(homePath, 'cache')

      const result = await installLinuxBareShieldDispatcher({
        resourcesPath,
        homePath,
        appImagePath,
        appImageCacheRootPath: cacheRootPath,
        appImageExtractRunner: async (_appImagePath, cwd) => {
          const launcherDir = join(cwd, 'squashfs-root', 'resources', 'bin')
          await mkdir(launcherDir, { recursive: true })
          await writeFile(join(launcherDir, 'shield-ide'), '', { encoding: 'utf8', mode: 0o755 })
        }
      })

      expect(result.state).toBe('installed')
      expect(relative(cacheRootPath, result.target as string).split(sep)).toEqual([
        'launcher',
        'shield-ide'
      ])
      const content = await readFile(result.dispatcherPath, 'utf8')
      expect(content).toContain(result.target as string)
      expect(content).not.toContain(resourcesPath)
      expect(content).not.toContain(appImagePath)
    }
  )

  it('skips (does not clobber) a user-owned shield already at ~/.local/bin', async () => {
    const { homePath, resourcesPath } = await makeFixture()
    const dispatcherPath = join(homePath, '.local', 'bin', 'shield')
    const appImagePath = join(homePath, 'Shield.AppImage')
    await mkdir(join(homePath, '.local', 'bin'), { recursive: true })
    await writeFile(dispatcherPath, '#!/bin/sh\necho my own shield\n', 'utf8')
    await writeFile(appImagePath, '#!/usr/bin/env bash\n', 'utf8')
    const extract = vi.fn()

    const result = await installLinuxBareShieldDispatcher({
      resourcesPath,
      homePath,
      appImagePath,
      appImageExtractRunner: extract
    })

    expect(result.state).toBe('skipped-foreign')
    expect(result.target).toBeNull()
    expect(extract).not.toHaveBeenCalled()
    expect(await readFile(dispatcherPath, 'utf8')).toBe('#!/bin/sh\necho my own shield\n')
  })

  it('preserves a foreign dispatcher created while AppImage extraction is in flight', async () => {
    const { homePath, resourcesPath } = await makeFixture()
    const appImagePath = join(homePath, 'Shield.AppImage')
    const cacheRootPath = join(homePath, 'cache')
    const dispatcherPath = join(homePath, '.local', 'bin', 'shield')
    await mkdir(homePath, { recursive: true })
    await writeFile(appImagePath, '#!/usr/bin/env bash\n', { mode: 0o755 })
    let reportStarted!: () => void
    let releaseExtraction!: () => void
    const started = new Promise<void>((resolve) => {
      reportStarted = resolve
    })
    const released = new Promise<void>((resolve) => {
      releaseExtraction = resolve
    })

    const installation = installLinuxBareShieldDispatcher({
      resourcesPath,
      homePath,
      appImagePath,
      appImageCacheRootPath: cacheRootPath,
      appImageExtractRunner: async (_path, cwd) => {
        await writePayload(cwd)
        reportStarted()
        await released
      }
    })
    await started
    await mkdir(dirname(dispatcherPath), { recursive: true })
    await writeFile(dispatcherPath, '#!/bin/sh\necho foreign\n', { mode: 0o755 })
    releaseExtraction()

    await expect(installation).resolves.toMatchObject({
      state: 'skipped-foreign',
      target: null
    })
    await expect(readFile(dispatcherPath, 'utf8')).resolves.toBe('#!/bin/sh\necho foreign\n')
  })

  it('prunes old owner generations without touching a sibling namespace', async () => {
    const { homePath, resourcesPath } = await makeFixture()
    const appImagePath = join(homePath, 'Shield.AppImage')
    const cacheRootPath = join(homePath, 'cache', 'unused', '..')
    await mkdir(homePath, { recursive: true })
    await writeFile(appImagePath, '#!/usr/bin/env bash\n', { mode: 0o755 })
    const events: string[] = []
    const options = {
      resourcesPath,
      homePath,
      appImagePath,
      appImageCacheRootPath: cacheRootPath,
      appImageExtractRunner: async (_path: string, cwd: string) => {
        events.push('extract')
        await writePayload(cwd)
      }
    }

    await installLinuxBareShieldDispatcher(options)
    const previous = resolveAppImageExtractedRoot({ appImagePath, cacheRootPath })!
    const sibling = join(resolve(cacheRootPath), 'f'.repeat(24), 'e'.repeat(24))
    await mkdir(sibling, { recursive: true })
    await writeFile(appImagePath, '#!/usr/bin/env bash\n# next\n', { mode: 0o755 })
    const lockEntered = Promise.withResolvers<string>()
    const releaseLock = Promise.withResolvers<void>()
    events.length = 0
    registrationLock.pause = releaseLock.promise
    registrationLock.entered = (rootPath) => {
      events.push('lock-entered')
      lockEntered.resolve(rootPath)
    }
    registrationLock.completed = () => {
      events.push(
        existsSync(previous.rootPath) ? 'lock-left-before-prune' : 'lock-left-after-prune'
      )
    }

    const installation = installLinuxBareShieldDispatcher(options)
    await expect(lockEntered.promise).resolves.toBe(resolve(cacheRootPath))
    expect(events).toEqual(['lock-entered'])
    expect(existsSync(previous.rootPath)).toBe(true)
    releaseLock.resolve()
    await installation
    const current = resolveAppImageExtractedRoot({ appImagePath, cacheRootPath })!

    expect(events).toEqual(['lock-entered', 'extract', 'lock-left-after-prune'])
    expect(existsSync(previous.rootPath)).toBe(false)
    expect(existsSync(current.rootPath)).toBe(true)
    expect(existsSync(sibling)).toBe(true)
  })

  it('skips when the bundled shield-ide launcher is missing from the build', async () => {
    const root = await mkdtemp(join(tmpdir(), 'shield-bare-dispatcher-nolauncher-'))
    created.push(root)

    const result = await installLinuxBareShieldDispatcher({
      resourcesPath: join(root, 'resources'),
      homePath: join(root, 'home'),
      appImagePath: null
    })

    expect(result.state).toBe('skipped-launcher-missing')
    expect(result.target).toBeNull()
  })
})

async function writePayload(cwd: string): Promise<void> {
  const launcherDirectory = join(cwd, 'squashfs-root', 'resources', 'bin')
  await mkdir(launcherDirectory, { recursive: true })
  await writeFile(join(launcherDirectory, 'shield-ide'), '#!/usr/bin/env bash\n', { mode: 0o755 })
}
