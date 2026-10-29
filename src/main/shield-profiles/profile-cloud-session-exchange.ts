import type {
  ShieldCloudCapabilities,
  ShieldCloudOrgSummary,
  ShieldProfileCloudSummary
} from '../../shared/shield-profiles'

export type ShieldCloudSessionExchangeResponse = {
  accessToken: string
  refreshToken: string
  expiresAt: number
  cloud: ShieldProfileCloudSummary
  organizations?: ShieldCloudOrgSummary[]
  capabilities: ShieldCloudCapabilities
}
