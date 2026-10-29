import type { ShieldPushPayload } from './push-payload'

export type NativeDismissal = {
  remember(payload: ShieldPushPayload): Promise<void>
  wasDismissed(payload: ShieldPushPayload): Promise<boolean>
}
// Android and web use JavaScript storage; iOS requires the native ledger.
export const nativePushDismissal: NativeDismissal | null = null
