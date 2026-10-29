import { spawnProcess } from '@shield/process-host'
import { connect as netConnect } from 'node:net'
import type { ProcessSpec } from '@shield/process-host/process-spec'
import type { StartDetachedLike } from './vm-backend'

/** detached + ignored stdio + unref: the VM outlives this CLI/daemon process (Windows and POSIX). */
export const startDetachedProcess: StartDetachedLike = (spec: ProcessSpec) => {
  const child = spawnProcess({ ...spec, detached: true, stdio: 'ignore' })
  child.unref()
  return { pid: child.pid }
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

/** QMP round-trip: negotiate capabilities, then request a guest-facing ACPI powerdown. */
export const qmpSystemPowerdown = (port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const socket = netConnect({ host: '127.0.0.1', port })
    let stage = 0
    const fail = (error: Error): void => {
      socket.destroy()
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error(`qmp timeout on port ${port}`)), 5_000)
    socket.on('error', fail)
    socket.on('data', () => {
      stage += 1
      if (stage === 1) {
        socket.write('{"execute":"qmp_capabilities"}\n')
        return
      }
      socket.write('{"execute":"system_powerdown"}\n')
      clearTimeout(timer)
      socket.end()
      resolve()
    })
  })

export const sleepMs = delay
