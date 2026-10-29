import type { RunProcessLike } from './vm-backend'
import type { VmStopMode } from './vm-backend'

export type QemuStopDeps = {
  runProcess: RunProcessLike
  isPidAlive: (pid: number) => boolean
  sleep: (ms: number) => Promise<void>
  qmpPowerdown: (port: number) => Promise<void>
  platform: NodeJS.Platform
}

/** Resolves only when the qemu pid is gone; throws with an honest reason otherwise. */
export const stopQemuPid = async (
  deps: QemuStopDeps,
  pid: number,
  mode: VmStopMode,
  qmpPort: number
): Promise<void> => {
  if (mode === 'force') {
    if (deps.platform === 'win32') {
      const kill = await deps.runProcess({
        program: 'taskkill',
        args: ['/PID', String(pid), '/T', '/F'],
        timeoutMs: 15_000
      })
      if (kill.code !== 0) {
        throw new Error(
          `taskkill ${String(pid)} failed: ${kill.stderr.trim() || `exit ${String(kill.code)}`}`
        )
      }
    } else {
      process.kill(pid, 'SIGKILL')
    }
    for (let waited = 0; waited < 5_000; waited += 250) {
      if (!deps.isPidAlive(pid)) {
        return
      }
      await deps.sleep(250)
    }
    throw new Error(`force stop did not retire qemu pid ${String(pid)}`)
  }
  await deps.qmpPowerdown(qmpPort)
  for (let waited = 0; waited < 30_000; waited += 500) {
    if (!deps.isPidAlive(pid)) {
      return
    }
    await deps.sleep(500)
  }
  throw new Error(`acpi powerdown did not retire qemu pid ${String(pid)} within 30s; use force`)
}
