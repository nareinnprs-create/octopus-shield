import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { access, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { createElectronHomeIsolation } from './electron-home-isolation'

const execFileAsync = promisify(execFile)
const RUNTIME_METADATA_FILE = 'shield-runtime.json'
let shieldDevUserDataPath: string | null = null
let shieldServeProcess: ChildProcess | null = null
let shieldServeStdout = ''
let shieldServeStderr = ''

export type CliResult = {
  stdout: string
  stderr: string
}

type RunShieldCliOptions = {
  retryMissingRuntimeMetadata?: boolean
}

export async function runShieldCli(
  args: string[],
  options: RunShieldCliOptions = {}
): Promise<CliResult> {
  try {
    return await runShieldCliOnce(args)
  } catch (error) {
    if (
      options.retryMissingRuntimeMetadata !== false &&
      isMissingRuntimeMetadataError(args, error)
    ) {
      // Windows can lose the dev runtime while launching the fixture app; reopen once before the desktop action.
      await ensureShieldRuntimeLaunched()
      return await runShieldCliOnce(args)
    }
    throw error
  }
}

async function runShieldCliOnce(args: string[]): Promise<CliResult> {
  const devCli = join(process.cwd(), 'config/scripts/shield-dev.mjs')
  const command = process.env.OSHIELD_COMPUTER_CLI ?? process.execPath
  const cliArgs = process.env.OSHIELD_COMPUTER_CLI ? args : [devCli, ...args]
  const env = process.env.OSHIELD_COMPUTER_CLI
    ? { ...process.env }
    : await createComputerE2ERuntimeEnv()
  try {
    const result = await execFileAsync(command, cliArgs, {
      env,
      maxBuffer: 20 * 1024 * 1024
    })
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
      const output = error as { message: string; stdout: string; stderr: string }
      throw new Error(`${output.message}\nstdout:\n${output.stdout}\nstderr:\n${output.stderr}`)
    }
    throw error
  }
}

export async function ensureShieldRuntimeLaunched(): Promise<void> {
  if (!process.env.OSHIELD_COMPUTER_CLI && process.platform === 'win32') {
    await ensureShieldRuntimeServed()
    return
  }
  await runShieldCli(['open', '--json'], { retryMissingRuntimeMetadata: false })
  await waitForShieldRuntimeReady()
}

export async function stopShieldRuntime(): Promise<void> {
  const processToStop = shieldServeProcess
  if (!processToStop?.pid) {
    return
  }
  shieldServeProcess = null
  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(processToStop.pid), '/T', '/F'])
    } catch {
      // The foreground test runtime may already have exited.
    }
    return
  }
  processToStop.kill()
}

export function parseJsonOutput<T>(stdout: string): T {
  return JSON.parse(stdout) as T
}

async function getComputerE2eShieldDevUserDataPath(): Promise<string> {
  if (!shieldDevUserDataPath) {
    // Use a fresh profile so a retained dev runtime cannot execute stale provider code.
    shieldDevUserDataPath = await mkdtemp(join(tmpdir(), 'shield-computer-runtime-'))
  }
  return shieldDevUserDataPath
}

async function waitForShieldRuntimeReady(): Promise<void> {
  const userDataPath = await getComputerE2eShieldDevUserDataPath()
  const metadataPath = join(userDataPath, RUNTIME_METADATA_FILE)
  const deadline = Date.now() + 15000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    try {
      await access(metadataPath)
      const status = parseJsonOutput<{
        result: { runtime: { reachable: boolean } }
      }>((await runShieldCli(['status', '--json'], { retryMissingRuntimeMetadata: false })).stdout)
      if (status.result.runtime.reachable) {
        return
      }
    } catch (error) {
      lastError = error
    }
    await delay(250)
  }

  const detail = [
    lastError instanceof Error ? `Last error: ${lastError.message}` : null,
    shieldServeStdout.trim() ? `serve stdout: ${shieldServeStdout.trim()}` : null,
    shieldServeStderr.trim() ? `serve stderr: ${shieldServeStderr.trim()}` : null
  ]
    .filter(Boolean)
    .join(' ')
  throw new Error(`Shield runtime metadata was not ready at ${metadataPath}.${detail}`)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function ensureShieldRuntimeServed(): Promise<void> {
  if (!shieldServeProcess || shieldServeProcess.exitCode !== null) {
    const devCli = join(process.cwd(), 'config/scripts/shield-dev.mjs')
    const env = await createComputerE2ERuntimeEnv()
    shieldServeStdout = ''
    shieldServeStderr = ''
    shieldServeProcess = spawn(process.execPath, [devCli, 'serve', '--no-pairing', '--json'], {
      env,
      windowsHide: true
    })
    shieldServeProcess.stdout?.on('data', (chunk) => {
      shieldServeStdout += String(chunk)
    })
    shieldServeProcess.stderr?.on('data', (chunk) => {
      shieldServeStderr += String(chunk)
    })
    shieldServeProcess.once('exit', () => {
      shieldServeProcess = null
    })
    process.once('exit', () => {
      shieldServeProcess?.kill()
    })
  }
  await waitForShieldRuntimeReady()
}

async function createComputerE2ERuntimeEnv(): Promise<NodeJS.ProcessEnv> {
  const userDataDir =
    process.env.OSHIELD_DEV_USER_DATA_PATH ?? (await getComputerE2eShieldDevUserDataPath())
  // Strip ELECTRON_RUN_AS_NODE or the Electron child runs as plain Node.
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...inheritedEnv } = process.env
  void _electronRunAsNode
  const isolation = createElectronHomeIsolation({
    inheritedEnv,
    launchEnv: {},
    extraEnv: {},
    userDataDir
  })
  return {
    ...isolation.env,
    // Keep CLI and Electron on the same runtime metadata while fixture HOME/Codex isolation remains in force.
    OSHIELD_DEV_USER_DATA_PATH: userDataDir
  }
}

function isMissingRuntimeMetadataError(args: string[], error: unknown): boolean {
  if (args[0] !== 'computer') {
    return false
  }
  if (!error || typeof error !== 'object' || !('message' in error)) {
    return false
  }
  const message = String((error as { message?: unknown }).message)
  return (
    message.includes('"code": "runtime_unavailable"') &&
    message.includes('Could not read Shield runtime metadata')
  )
}
