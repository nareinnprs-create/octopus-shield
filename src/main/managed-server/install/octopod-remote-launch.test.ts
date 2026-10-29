import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV } from '../../../shared/octopod-managed-launch-env'

import {
  OCTOPOD_READINESS_FILENAME,
  OctopodRemoteLaunchUnsupportedError
} from './octopod-remote-host-support'
import {
  octopodLaunchCommand,
  octopodLivenessBlocksGc,
  octopodLivenessProvenExited,
  octopodLivenessProbeCommand,
  parseOctopodLiveness,
  parseOctopodReadinessOutput
} from './octopod-remote-launch'
import {
  octopodStopFreedTheHost,
  parseOctopodStopOutcome,
  stopOctopodCommand
} from './octopod-remote-process-control'
import { getRemoteHostPlatform } from '../../ssh/ssh-remote-platform'

const posix = getRemoteHostPlatform('linux-x64')
const windows = getRemoteHostPlatform('win32-x64')

const SPEC = {
  remoteInstallDir: '/home/u/.shield-remote/octopod-0.2.0+bb01',
  nodePath: '/usr/bin/node',
  fullVersion: '0.2.0+bb01',
  userDataDir: '/home/u/.shield',
  bindHost: '127.0.0.1',
  port: 7777,
  activationRoot: '/home/u/.shield-remote/.octopod-activation-transaction'
}

const READY_LINE = JSON.stringify({
  type: 'shield_server_ready',
  schemaVersion: 1,
  runtimeId: 'r1',
  boundEndpoint: 'ws://127.0.0.1:7777',
  advertisedEndpoint: null,
  managedWslCliReconciliation: 'settled',
  pairing: { available: false, reason: 'disabled_by_operator', guidance: 'n/a' },
  health: { buildHash: 'abc', terminalDaemon: { state: 'live' } }
})

describe('octopodLaunchCommand', () => {
  it('states the bind posture rather than inheriting the build default', () => {
    expect(octopodLaunchCommand(posix, SPEC)).toContain("--bind '127.0.0.1'")
  })

  it('truncates the readiness file, so a stale line cannot be activated on', () => {
    const command = octopodLaunchCommand(posix, SPEC)
    const cd = command.indexOf(`cd '${SPEC.remoteInstallDir}'`)
    const truncate = command.indexOf(`: > '${OCTOPOD_READINESS_FILENAME}'`)
    const launch = command.indexOf('nohup')
    expect(cd).toBeGreaterThan(-1)
    expect(truncate).toBeGreaterThan(cd)
    expect(truncate).toBeLessThan(launch)
  })

  it('exports the version and the shared data root the deploy decided on', () => {
    const command = octopodLaunchCommand(posix, SPEC)
    expect(command).toContain(`OSHIELD_VERSION '${SPEC.fullVersion}'`.replace(' ', '='))
    expect(command).toContain(`OSHIELD_USER_DATA='${SPEC.userDataDir}'`)
  })

  it('names the activation fence on every launch, which enables idle exit', () => {
    const command = octopodLaunchCommand(posix, SPEC)
    expect(command).toContain(`${OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV}='${SPEC.activationRoot}'`)
    expect(command.indexOf(OCTOPOD_MANAGED_ACTIVATION_ROOT_ENV)).toBeLessThan(
      command.indexOf('nohup')
    )
  })

  it('declares the Windows refusal instead of emitting a command that cannot work', () => {
    expect(() => octopodLaunchCommand(windows, SPEC)).toThrow(OctopodRemoteLaunchUnsupportedError)
  })
})

describe('readiness parsing', () => {
  it('extracts the shield_server_ready payload', () => {
    const parsed = parseOctopodReadinessOutput(`${READY_LINE}\n`)
    expect(parsed).toMatchObject({ state: 'ready' })
    expect(parsed.state === 'ready' && parsed.readiness.boundEndpoint).toBe('ws://127.0.0.1:7777')
  })

  it('treats an empty or half-written file as pending, not as a failure', () => {
    expect(parseOctopodReadinessOutput('')).toEqual({ state: 'pending' })
    expect(parseOctopodReadinessOutput('{"type":"shield_serv')).toEqual({ state: 'pending' })
  })

  it('reports a complete JSON line that is not a readiness payload as malformed', () => {
    expect(parseOctopodReadinessOutput('{"type":"something_else"}')).toMatchObject({
      state: 'malformed'
    })
  })
})

describe('liveness', () => {
  it('reads the pid recorded in the version dir', () => {
    expect(octopodLivenessProbeCommand(posix, SPEC.remoteInstallDir)).toContain('.octopod-pid')
  })

  it.each([
    ['LIVE', 'LIVE', true],
    ['DEAD', 'DEAD', false],
    ['NEVER_LAUNCHED', 'NEVER_LAUNCHED', false],
    ['', 'UNKNOWN', true],
    ['garbage', 'UNKNOWN', true]
  ])('parses %s and blocks GC = %s', (output, expected, blocks) => {
    expect(parseOctopodLiveness(output)).toBe(expected)
    expect(octopodLivenessBlocksGc(parseOctopodLiveness(output))).toBe(blocks)
  })

  // Real host (win-lowspec): after a distro restart the probe's own shell took the recorded PID.
  describe.skipIf(process.platform === 'win32')(
    'a recorded PID after a restart (real shell)',
    () => {
      const probeIn = (script: string): string =>
        spawnSync('sh', ['-c', script], { encoding: 'utf8' }).stdout

      async function withSlot(run: (slot: string, probe: string) => Promise<void>): Promise<void> {
        const slot = mkdtempSync(join(tmpdir(), 'octopod-liveness-'))
        try {
          await run(slot, octopodLivenessProbeCommand(posix, slot))
        } finally {
          rmSync(slot, { recursive: true, force: true })
        }
      }

      async function waitForArgs(pid: number | undefined, needle: string): Promise<void> {
        for (let i = 0; i < 100; i++) {
          const args = spawnSync('ps', ['-o', 'args=', '-p', String(pid)], { encoding: 'utf8' })
          if (args.stdout.includes(needle)) {
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        throw new Error(`process ${pid} never showed ${needle}`)
      }

      it('calls dead a PID held by the probe shell or the shell wrapping it', async () => {
        await withSlot(async (slot, probe) => {
          const own = probeIn(`echo $$ > '${slot}/.octopod-pid'; ${probe}`)
          expect(parseOctopodLiveness(own)).toBe('DEAD')
          // The trailing `:` stops dash and bash from exec'ing the inner shell into the outer's PID.
          const wrapped = probeIn(
            `echo $$ > '${slot}/.octopod-pid'; sh -c ${JSON.stringify(probe).replace(/\$/g, '\\$')}; :`
          )
          expect(parseOctopodLiveness(wrapped)).toBe('DEAD')
        })
      })

      it('keeps a live octopod, and the waiting shell of an older launcher, live', async () => {
        await withSlot(async (slot, probe) => {
          const entry = join(slot, 'octopod.js')
          writeFileSync(entry, 'setInterval(() => {}, 1000)\n')
          const octopod = spawn(process.execPath, [entry], { stdio: 'ignore' })
          // Before `exec` landed in the launcher, the recorded PID was a shell waiting on node.
          const waiting = spawn('sh', ['-c', `'${process.execPath}' '${entry}'; :`], {
            stdio: 'ignore',
            // Own process group, so cleanup also reaches the node the shell waits on.
            detached: true
          })
          try {
            await waitForArgs(octopod.pid, 'octopod.js')
            writeFileSync(join(slot, '.octopod-pid'), `${octopod.pid}\n`)
            expect(parseOctopodLiveness(probeIn(probe))).toBe('LIVE')
            await waitForArgs(waiting.pid, 'octopod.js')
            writeFileSync(join(slot, '.octopod-pid'), `${waiting.pid}\n`)
            expect(parseOctopodLiveness(probeIn(probe))).toBe('LIVE')
          } finally {
            octopod.kill()
            if (waiting.pid !== undefined) {
              process.kill(-waiting.pid, 'SIGKILL')
            }
          }
        })
      })
    }
  )

  it.each([
    ['DEAD', true],
    ['NEVER_LAUNCHED', true],
    ['LIVE', false],
    ['UNKNOWN', false]
  ] as const)('%s is proven exit = %s', (liveness, exited) => {
    expect(octopodLivenessProvenExited(liveness)).toBe(exited)
  })
})

describe('stopping a running octopod', () => {
  it('sends SIGTERM and never SIGKILL', () => {
    const command = stopOctopodCommand(posix, SPEC.remoteInstallDir, {
      waitSeconds: 20,
      nodePath: SPEC.nodePath
    })
    expect(command).toContain('kill -TERM')
    for (const kill of ['kill -9', 'kill -KILL', 'kill -SIGKILL', 'pkill']) {
      expect(command).not.toContain(kill)
    }
  })

  it.each([
    ['STOPPED', 'stopped', true],
    ['ALREADY_EXITED', 'already-exited', true],
    ['NO_PID', 'no-pid', false],
    ['STILL_RUNNING', 'still-running', false],
    ['SIGNAL_FAILED', 'signal-failed', false],
    ['UNKNOWN', 'unknown', false],
    ['SIGNALED\nUNKNOWN', 'unconfirmed', false],
    ['', 'unconfirmed', false]
  ])('parses %s and frees the host = %s', (output, expected, frees) => {
    expect(parseOctopodStopOutcome(output)).toBe(expected)
    expect(octopodStopFreedTheHost(parseOctopodStopOutcome(output))).toBe(frees)
  })
})
