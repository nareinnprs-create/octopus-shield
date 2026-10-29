/** Check snapshot room before stopping a serving incumbent (#30491). */
import { octopodRemoteBaseDir } from '../managed-server/install/octopod-remote-windows-node'
import { execOctopodRemoteOr } from '../managed-server/install/octopod-remote-runtime-control'
import {
  OCTOPOD_STATE_SNAPSHOT_DIR,
  type OctopodActivationRecord
} from '../managed-server/activation/octopod-activation-record'
import {
  octopodSnapshotShortfallKb,
  octopodSnapshotShortfallMessage,
  octopodSnapshotSpaceCommand,
  parseOctopodSnapshotSpace
} from '../managed-server/host-state/octopod-state-snapshot-space'
import { joinRemotePath } from './ssh-remote-platform'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import type { OctopodSlotOptions } from './octopod-recovery-slot'

export const OCTOPOD_SNAPSHOT_SPACE_INSUFFICIENT_CODE = 'octopod_snapshot_space_insufficient'

export function octopodSnapshotsRoot(options: Pick<OctopodSlotOptions, 'host' | 'remoteHome'>): string {
  return joinRemotePath(
    options.host,
    octopodRemoteBaseDir(options.host, options.remoteHome),
    OCTOPOD_STATE_SNAPSHOT_DIR
  )
}

/** Unknown room proceeds to authoritative capture; return a refusal only for proven insufficient space. */
export async function octopodSnapshotRoomRefusal(
  options: OctopodSlotOptions,
  record: OctopodActivationRecord,
  fullVersion: string
): Promise<string | null> {
  const baseDir = octopodRemoteBaseDir(options.host, options.remoteHome)
  const command = octopodSnapshotSpaceCommand(
    options.host,
    options.userDataDir,
    octopodSnapshotsRoot(options),
    baseDir,
    record.snapshot ? [record.snapshot.dirName] : []
  )
  if (!command) {
    return null
  }
  const space = parseOctopodSnapshotSpace(await measureRoom(options, command))
  const shortfall = octopodSnapshotShortfallKb(space)
  return space && shortfall !== null
    ? octopodSnapshotShortfallMessage(space, shortfall, {
        userDataDir: options.userDataDir,
        baseDir,
        fullVersion,
        active: record.active
      })
    : null
}

async function measureRoom(options: OctopodSlotOptions, command: string): Promise<string> {
  try {
    return await execOctopodRemoteOr(options, command)
  } catch (error) {
    // Unconfirmed read-only cleanup leaves room unknown; capture decides, unless caller cancelled.
    if (isUnconfirmedSshCommandTermination(error) && !options.signal?.aborted) {
      return ''
    }
    throw error
  }
}
