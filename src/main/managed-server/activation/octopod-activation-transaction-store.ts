import {
  octopodActivationTransactionPath,
  parseOctopodActivationTransaction,
  serializeOctopodActivationTransaction,
  type OctopodActivationTransaction
} from './octopod-activation-transaction'
import {
  readBoundedOctopodRemoteRecord,
  writeAtomicOctopodRemoteRecord
} from '../install/octopod-remote-record-file'
import type { OctopodRemoteExecTarget } from '../install/octopod-remote-runtime-control'
import { currentOctopodFence } from './octopod-activation-fence-scope'

const OCTOPOD_ACTIVATION_TRANSACTION_MAX_BYTES = 64 * 1024

type OctopodActivationTransactionStoreOptions = OctopodRemoteExecTarget & { remoteHome: string }

/** Only verified absence returns null; unreadable journals retain the fence. */
export async function readOctopodActivationTransaction(
  options: OctopodActivationTransactionStoreOptions
): Promise<OctopodActivationTransaction | null> {
  const read = await readBoundedOctopodRemoteRecord(
    options,
    octopodActivationTransactionPath(options.host, options.remoteHome),
    OCTOPOD_ACTIVATION_TRANSACTION_MAX_BYTES
  )
  const parsed = parseOctopodActivationTransaction(read.state === 'present' ? read.raw : null)
  if (parsed.state === 'unreadable') {
    throw new Error(`Cannot read this host's octopod activation transaction: ${parsed.reason}`)
  }
  return parsed.state === 'ok' ? parsed.transaction : null
}

/** Stamp each write with its fence generation so release cannot delete another holder's journal. */
export function writeOctopodActivationTransaction(
  options: OctopodActivationTransactionStoreOptions,
  transaction: OctopodActivationTransaction
): Promise<void> {
  const fenceToken = currentOctopodFence()?.token
  return writeAtomicOctopodRemoteRecord(
    options,
    octopodActivationTransactionPath(options.host, options.remoteHome),
    serializeOctopodActivationTransaction(fenceToken ? { ...transaction, fenceToken } : transaction)
  )
}
