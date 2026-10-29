// Unreadable activation records must fail closed; treating them as absent could overwrite a live install and its rollback target.
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import {
  OCTOPOD_ACTIVATION_FILENAME,
  emptyOctopodActivationRecord,
  parseOctopodActivationRecord,
  serializeOctopodActivationRecord,
  type OctopodActivationReadResult,
  type OctopodActivationRecord
} from './octopod-activation-record'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'
import {
  readBoundedOctopodRemoteRecord,
  writeAtomicOctopodRemoteRecord
} from '../install/octopod-remote-record-file'

const OCTOPOD_ACTIVATION_RECORD_MAX_BYTES = 64 * 1024

type ActivationRecordTarget = {
  conn: OctopodHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  signal?: AbortSignal
}

function octopodActivationPath(host: RemoteHostPlatform, remoteHome: string): string {
  return joinRemotePath(host, remoteHome, RELAY_REMOTE_DIR, OCTOPOD_ACTIVATION_FILENAME)
}

async function readActivationRecordState(
  options: ActivationRecordTarget
): Promise<OctopodActivationReadResult> {
  const read = await readBoundedOctopodRemoteRecord(
    options,
    octopodActivationPath(options.host, options.remoteHome),
    OCTOPOD_ACTIVATION_RECORD_MAX_BYTES
  )
  return read.state === 'absent' ? read : parseOctopodActivationRecord(read.raw)
}

export async function readOctopodActivationRecord(
  options: ActivationRecordTarget
): Promise<OctopodActivationRecord> {
  const parsed = await readActivationRecordState(options)
  if (parsed.state === 'ok') {
    return parsed.record
  }
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's octopod activation record: ${parsed.reason}`)
  }
  return emptyOctopodActivationRecord()
}

/** Refuse replacement of unreadable records, including schemas written by newer clients. */
export async function writeOctopodActivationRecord(
  options: ActivationRecordTarget,
  record: OctopodActivationRecord
): Promise<void> {
  const existing = await readActivationRecordState(options)
  if (existing.state === 'unreadable') {
    throw new Error(`Refusing to overwrite this host's octopod activation record: ${existing.reason}`)
  }
  await writeAtomicOctopodRemoteRecord(
    options,
    octopodActivationPath(options.host, options.remoteHome),
    serializeOctopodActivationRecord(record)
  )
}
