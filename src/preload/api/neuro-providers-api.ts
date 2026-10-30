import type {
  NeuroConnectionTestResult,
  NeuroProviderProfile,
  NeuroProviderStatus
} from '../../shared/neuro-provider-types'

export type NeuroProvidersApi = {
  getStatus: () => Promise<NeuroProviderStatus>
  save: (profile: NeuroProviderProfile) => Promise<NeuroProviderStatus>
  remove: (id: string) => Promise<NeuroProviderStatus>
  saveApiKey: (id: string, key: string) => Promise<NeuroProviderStatus>
  clearApiKey: (id: string) => Promise<NeuroProviderStatus>
  /** Tests a draft profile with an optional key; falls back to the saved key. */
  test: (input: {
    profile: NeuroProviderProfile
    key?: string
  }) => Promise<NeuroConnectionTestResult>
}
