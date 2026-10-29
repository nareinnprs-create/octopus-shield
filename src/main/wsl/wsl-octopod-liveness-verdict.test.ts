import { describe, expect, it } from 'vitest'
import {
  classifyWslOctopodLiveness,
  nextWslLivenessProbe,
  type WslLivenessEvidence
} from './wsl-octopod-liveness-verdict'

const INSTANCE = 'boot-a:100'
const OCTOPOD = '321:5000'

function evidence(overrides: Partial<WslLivenessEvidence> = {}): WslLivenessEvidence {
  return {
    trigger: { source: 'bridge', code: 1 },
    running: { status: 'confirmed', running: true },
    expected: { distroInstance: INSTANCE, octopod: OCTOPOD },
    ...overrides
  }
}

describe('classifyWslOctopodLiveness', () => {
  it('reads a failed running-list probe as unverifiable, never exited, whatever the exit code', () => {
    for (const code of [0, 1, null]) {
      const verdict = classifyWslOctopodLiveness(
        evidence({ trigger: { source: 'bridge', code }, running: { status: 'unavailable' } })
      )
      expect(verdict).toEqual({ kind: 'unverifiable', reason: 'running-list-unavailable' })
    }
  })

  it('marks every terminal exited when the distro is confirmed stopped', () => {
    const verdict = classifyWslOctopodLiveness(
      evidence({ running: { status: 'confirmed', running: false } })
    )
    expect(verdict).toEqual({ kind: 'distro-stopped', corroborated: true })
  })

  it('needs no exit code to prove a stop, but only a failed exit corroborates it', () => {
    const stopped = { status: 'confirmed', running: false } as const
    expect(
      classifyWslOctopodLiveness(evidence({ trigger: { source: 'verify' }, running: stopped }))
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
    expect(
      classifyWslOctopodLiveness(
        evidence({ trigger: { source: 'holder', code: 0 }, running: stopped })
      )
    ).toEqual({ kind: 'distro-stopped', corroborated: false })
  })

  it('treats a running distro whose guest did not answer as unverifiable', () => {
    expect(classifyWslOctopodLiveness(evidence({ identity: null }))).toEqual({
      kind: 'unverifiable',
      reason: 'guest-unanswered'
    })
  })

  it('proves a restart from a new boot id or pid 1 start time, without any wall clock', () => {
    const verdict = classifyWslOctopodLiveness(
      evidence({ identity: { distroInstance: 'boot-a:900', octopod: null } })
    )
    expect(verdict).toEqual({ kind: 'distro-restarted' })
  })

  it('reads a gone or reused octopod pid in the same incarnation as octopod exited', () => {
    for (const octopod of [null, '321:7777']) {
      const verdict = classifyWslOctopodLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, octopod }
        })
      )
      expect(verdict).toEqual({ kind: 'octopod-exited' })
    }
  })

  it('keeps octopod live when the same process still runs, even after a bridge exit', () => {
    expect(
      classifyWslOctopodLiveness(
        evidence({
          trigger: { source: 'bridge', code: 0 },
          identity: { distroInstance: INSTANCE, octopod: OCTOPOD }
        })
      )
    ).toEqual({ kind: 'live' })
  })

  it('falls back to the port when no octopod pid was known', () => {
    const base = evidence({
      expected: { distroInstance: INSTANCE, octopod: null },
      identity: { distroInstance: INSTANCE, octopod: null }
    })
    expect(classifyWslOctopodLiveness({ ...base, octopodPort: 'ready' })).toEqual({ kind: 'live' })
    expect(classifyWslOctopodLiveness({ ...base, octopodPort: 'refused' })).toEqual({
      kind: 'octopod-exited'
    })
    expect(classifyWslOctopodLiveness({ ...base, octopodPort: 'unverifiable' })).toEqual({
      kind: 'unverifiable',
      reason: 'octopod-unanswered'
    })
  })
})

describe('nextWslLivenessProbe', () => {
  it('never probes inside a distro that is not confirmed running (an exec would boot it)', () => {
    expect(nextWslLivenessProbe(evidence({ running: { status: 'unavailable' } }))).toBeNull()
    expect(
      nextWslLivenessProbe(evidence({ running: { status: 'confirmed', running: false } }))
    ).toBeNull()
  })

  it('asks for identity first, and for the port only when no pid identity can decide', () => {
    expect(nextWslLivenessProbe(evidence())).toBe('identity')
    expect(
      nextWslLivenessProbe(evidence({ identity: { distroInstance: INSTANCE, octopod: OCTOPOD } }))
    ).toBeNull()
    const noPid = evidence({
      expected: { distroInstance: INSTANCE, octopod: null },
      identity: { distroInstance: INSTANCE, octopod: null }
    })
    expect(nextWslLivenessProbe(noPid)).toBe('octopod-port')
    expect(nextWslLivenessProbe({ ...noPid, octopodPort: 'refused' })).toBeNull()
    expect(
      nextWslLivenessProbe({ ...noPid, identity: { distroInstance: 'other', octopod: null } })
    ).toBeNull()
  })
})
