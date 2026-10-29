import { expect, it } from 'vitest'
import { PushNotificationSchema } from '@shield-cloud/push-contract'
import { buildPushDelivery, shieldDataStrings } from './push-delivery-message.js'

it('preserves pane identity for both APNs and FCM, and accepts older workspace-only messages', () => {
  const base = {
    notificationSeq: 1,
    notificationEpoch: 'epoch',
    source: 'agent-task-complete',
    agentState: 'finished',
    title: 'Done',
    body: '',
    worktreeId: 'folder:/work'
  }
  const paneKey = 'tab-b:11111111-1111-4111-8111-111111111111'
  for (const extra of [{}, { paneKey }]) {
    const notification = PushNotificationSchema.parse({ ...base, ...extra })
    const delivery = buildPushDelivery({
      notification,
      hostFingerprint: 'host',
      registrationId: 'phone',
      expiresAt: Date.now() + 300000
    })
    expect(delivery.shield.paneKey).toBe('paneKey' in extra ? paneKey : undefined)
    expect(shieldDataStrings(delivery.shield).paneKey).toBe('paneKey' in extra ? paneKey : undefined)
  }
})
