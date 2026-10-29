/** Release conversion setups stranded before staging by refused SSH forwarding. Stop any activated slot, unregister, then use undeployed-fence release; source rows remain intact for retry. */
import { listEnvironments } from '../../shared/runtime-environment-store'
import { removeManagedOctopodEnvironment } from '../../shared/runtime-environment-managed-octopod-store'
import { findOctopodMigrationSourceCutoverForTarget } from './octopod-migration-cutover-journal'
import { releaseUndeployedMigrationFence } from './octopod-migration-source-fence'
import { closeOctopodManagedTunnel } from '../managed-server/lifecycle/octopod-managed-tunnel'
import type { SshTargetOctopodClaims } from './targets/ssh-target-octopod-claims'
import { withOctopodActivationLock } from '../managed-server/activation/octopod-activation-lock'
import { withDeactivatedVersionCommitted } from '../managed-server/activation/octopod-activation-record'
import {
  readOctopodActivationRecord,
  writeOctopodActivationRecord
} from '../managed-server/activation/octopod-activation-record-store'
import { managedOctopodSlot } from '../managed-server/lifecycle/octopod-managed-runtime-context'
import { resolveOctopodRemoteContext } from '../managed-server/install/octopod-remote-context'
import { octopodStopFreedTheHost } from '../managed-server/install/octopod-remote-process-control'
import { octopodSlotDir, stopOctopodSlot } from './octopod-recovery-slot'
import { sshOctopodHostTransport } from './octopod-ssh-host-transport'
import { getSshConnectionManager, getSshTargetRegistryStore } from './targets/ssh-target-registry'
import { errorMessage } from '../../shared/error-message'

export async function releaseUnreachableOctopodSetup(args: {
  userDataPath: string
  claims: SshTargetOctopodClaims
  targetId: string
  signal?: AbortSignal
}): Promise<void> {
  const cutover = findOctopodMigrationSourceCutoverForTarget(args.userDataPath, args.targetId)
  // Staged/committed destinations require their own evidence before release.
  if (cutover?.phase !== 'source-fenced') {
    return
  }
  const environmentId = cutover.destinationEnvironmentId
  await closeOctopodManagedTunnel(environmentId).catch(() => undefined)
  await stopStrandedOctopod(args.targetId, args.signal).catch((error: unknown) => {
    console.warn(`[octopod] Could not stop the unreachable setup's server: ${errorMessage(error)}`)
  })
  const isRegistered = (id: string): boolean =>
    listEnvironments(args.userDataPath).some((entry) => entry.id === id)
  // Unregister first so an interrupted release leaves a recoverable undeployed fence.
  if (isRegistered(environmentId)) {
    removeManagedOctopodEnvironment(args.userDataPath, environmentId)
  }
  await releaseUndeployedMigrationFence({
    userDataPath: args.userDataPath,
    claims: args.claims,
    targetId: args.targetId,
    isDestinationRegistered: isRegistered,
    signal: args.signal
  })
}

/** Clear active only after proven slot exit; daemon terminals may outlive it. */
async function stopStrandedOctopod(targetId: string, signal?: AbortSignal): Promise<void> {
  const target = getSshTargetRegistryStore()?.getTarget(targetId)
  const connectionManager = getSshConnectionManager()
  if (!target || !connectionManager) {
    return
  }
  const context = await resolveOctopodRemoteContext(
    target,
    sshOctopodHostTransport(await connectionManager.connect(target)),
    signal
  )
  if (!context.activationRecord.active) {
    return
  }
  // Port is irrelevant because this recovery never launches a slot.
  const slot = managedOctopodSlot(context, 0, signal)
  await withOctopodActivationLock(
    slot,
    async () => {
      const record = await readOctopodActivationRecord(slot)
      if (!record.active) {
        return
      }
      const stopped = await stopOctopodSlot(slot, octopodSlotDir(slot, record.active), false)
      if (octopodStopFreedTheHost(stopped)) {
        await writeOctopodActivationRecord(slot, withDeactivatedVersionCommitted(record))
      }
    },
    () => undefined
  )
}
