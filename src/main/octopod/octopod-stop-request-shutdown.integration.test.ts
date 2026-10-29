// Windows signals skip graceful cleanup; prove the packaged stop-file path flushes and releases locks.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnProcess } from '@shield/process-host'
import { OCTOPOD_NODE_RUNTIME_MARKER_FILENAME } from '../../shared/octopod-artifacts'
import { OCTOPOD_STOP_REQUEST_FILENAME } from '../../shared/octopod-stop-request'
import {
  killChildAndWait,
  killProfileDaemons,
  recordProfileDaemons,
  removeTestRoot
} from './octopod-daemon-teardown-fixture'
import { parseOctopodReadinessOutput } from '../managed-server/install/octopod-remote-launch'
import { OCTOPOD_LOCK_FILE_NAME, readOctopodInstanceLockRecord } from './octopod-instance-lock'
import { OCTOPOD_SHUTDOWN_DEADLINE_MS } from './octopod-stop-deadlines'
import {
  installPackagedOctopodSlotForTests,
  locatePinnedNodeForTests,
  skipForMissingInputs
} from './octopod-node-slot-fixture'

const pinnedNode = locatePinnedNodeForTests()
const skip = skipForMissingInputs('artifact', [
  ...(pinnedNode ? [] : ['the pinned Node (OSHIELD_PINNED_NODE or out/runtimes)']),
  ...(existsSync(join('out/octopod', OCTOPOD_NODE_RUNTIME_MARKER_FILENAME))
    ? []
    : ['a Node octopod slot in out/octopod (pnpm build:octopod)'])
])

let root = ''
const children: ReturnType<typeof spawnProcess>[] = []

/** Clear Vitest markers so daemon-entry starts its server. */
function hostEnv(userData: string): NodeJS.ProcessEnv {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'NODE_ENV')
    ),
    OSHIELD_BACKGROUND_LAUNCH: '1',
    OSHIELD_DISABLE_MACOS_LOGIN_SHELL: '1',
    OSHIELD_VERSION: '0.0.0-stop-request-test',
    OSHIELD_USER_DATA: userData
  }
}

afterEach(async () => {
  for (const child of children.splice(0)) {
    await killChildAndWait(child)
  }
  if (root) {
    // Daemons outlive the server; stop them before deleting their data root.
    await killProfileDaemons(join(root, 'data'))
    await removeTestRoot(root)
  }
  // Cold Windows arm64 slots can take over a minute to delete.
}, 180_000)

describe.skipIf(skip)('packaged octopod stop request', () => {
  it(`stops cleanly within ${OCTOPOD_SHUTDOWN_DEADLINE_MS} ms of its slot's stop-request file`, async () => {
    root = mkdtempSync(join(tmpdir(), 'octopod-stop-request-'))
    const { slotDir, runtime } = installPackagedOctopodSlotForTests(root, pinnedNode!)
    const userData = join(root, 'data')
    const launchedAt = Date.now()
    const child = spawnProcess({
      program: runtime,
      args: [join(slotDir, 'octopod.js'), '--json', '--bind', '127.0.0.1', '--port', '0'],
      cwd: slotDir,
      env: hostEnv(userData),
      timeoutMs: null
    })
    children.push(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))

    await vi.waitFor(
      () => {
        const parsed = parseOctopodReadinessOutput(stdout)
        if (parsed.state !== 'ready') {
          throw new Error(`octopod not ready (${parsed.state}): ${stderr.slice(-2000)}`)
        }
        expect(parsed.readiness.health?.stopRequests).toBe(1)
      },
      { timeout: 90_000, interval: 250 }
    )

    const lock = readOctopodInstanceLockRecord(join(userData, OCTOPOD_LOCK_FILE_NAME))
    expect(lock?.pid).toBe(child.pid)
    expect(lock?.startedAtMs).toEqual(expect.any(Number))
    expect(Math.abs(lock!.startedAtMs! - launchedAt)).toBeLessThan(30_000)

    await recordProfileDaemons(userData)
    const requestedAt = Date.now()
    writeFileSync(join(slotDir, OCTOPOD_STOP_REQUEST_FILENAME), '')
    const code = await exited
    const elapsedMs = Date.now() - requestedAt
    expect(code, stderr.slice(-2000)).toBe(0)
    expect(elapsedMs).toBeLessThan(OCTOPOD_SHUTDOWN_DEADLINE_MS)
    expect(existsSync(join(userData, OCTOPOD_LOCK_FILE_NAME))).toBe(false)
    expect(existsSync(join(slotDir, OCTOPOD_STOP_REQUEST_FILENAME))).toBe(false)
  }, 150_000)
})
