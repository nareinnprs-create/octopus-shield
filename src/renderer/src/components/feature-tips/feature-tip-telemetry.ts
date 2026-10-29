import { track } from '@/lib/telemetry'
import type { EventProps } from '../../../../shared/telemetry-events'

export type ShieldCliFeatureTipSource = EventProps<'shield_cli_feature_tip_shown'>['source']
export type ShieldCliFeatureTipSetupResult = EventProps<'shield_cli_feature_tip_setup_result'>['result']
export type CmdJPaletteFeatureTipSource = EventProps<'cmd_j_palette_feature_tip_shown'>['source']

export function getShieldCliFeatureTipTelemetrySource(value: unknown): ShieldCliFeatureTipSource {
  return value === 'app_open' ? 'app_open' : 'manual'
}

export function trackShieldCliFeatureTipShown(source: ShieldCliFeatureTipSource): void {
  track('shield_cli_feature_tip_shown', { source })
}

export function trackShieldCliFeatureTipSetupClicked(source: ShieldCliFeatureTipSource): void {
  track('shield_cli_feature_tip_setup_clicked', { source })
}

export function trackShieldCliFeatureTipSetupResult(
  source: ShieldCliFeatureTipSource,
  result: ShieldCliFeatureTipSetupResult
): void {
  track('shield_cli_feature_tip_setup_result', { source, result })
}

export function trackCmdJPaletteFeatureTipShown(source: CmdJPaletteFeatureTipSource): void {
  track('cmd_j_palette_feature_tip_shown', { source })
}

export function trackCmdJPaletteFeatureTipAcknowledged(source: CmdJPaletteFeatureTipSource): void {
  track('cmd_j_palette_feature_tip_acknowledged', { source })
}
