import { describe, expect, it } from 'vitest'
import {
  emitOctopodProfileStateAuthoritySelected,
  formatOctopodProfileStateAuthoritySelected,
  type OctopodProfileStateAuthoritySelection
} from './octopod-profile-state-telemetry'

const selection: OctopodProfileStateAuthoritySelection = {
  backend: 'sqlite',
  classification: 'json-only',
  authority_mode: 'sqlite-established',
  runtime: 'octopod',
  migrated: true
}

describe('octopod profile-state telemetry', () => {
  it('strips unexpected runtime fields before writing the record', () => {
    const selectionWithRuntimeFields = Object.assign({}, selection, {
      database_path: '/private/profile-state.db'
    })
    const line = formatOctopodProfileStateAuthoritySelected(selectionWithRuntimeFields)
    expect(line).not.toContain('database_path')
  })

  it('never lets a failing sink block startup', () => {
    expect(() =>
      emitOctopodProfileStateAuthoritySelected(selection, () => {
        throw new Error('closed stderr')
      })
    ).not.toThrow()
  })
})
