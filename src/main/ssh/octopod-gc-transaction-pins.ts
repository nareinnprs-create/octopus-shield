/** Pin every journaled slot needed for recovery. An unreadable journal or unjournaled held fence hides transaction state, so GC must retain everything. */
import { octopodInstallDirNames } from '../managed-server/activation/octopod-activation-record'
import type { OctopodActivationTransaction } from '../managed-server/activation/octopod-activation-transaction'
import { readOctopodActivationTransaction } from '../managed-server/activation/octopod-activation-transaction-store'
import { octopodActivationFenceExists } from '../managed-server/activation/octopod-activation-lock'
import { isUnconfirmedSshCommandTermination } from './remote-exec/remote-exec-command'
import type { OctopodRemoteExecTarget } from '../managed-server/install/octopod-remote-runtime-control'

type OctopodGcTransactionPins = { state: 'pinned'; dirNames: string[] } | { state: 'keep-all' }

function transactionVersions(transaction: OctopodActivationTransaction): (string | null)[] {
  const records = [transaction.recordBefore, transaction.recordAfter]
  const fromRecords = records.flatMap((record) => (record ? [record.active, record.previous] : []))
  if (transaction.operation === 'activate') {
    return [...fromRecords, transaction.candidateVersion]
  }
  return transaction.operation === 'rollback'
    ? [...fromRecords, transaction.incumbentVersion, transaction.targetVersion]
    : fromRecords
}

export async function readOctopodGcTransactionPins(
  target: OctopodRemoteExecTarget & { remoteHome: string }
): Promise<OctopodGcTransactionPins> {
  try {
    const transaction = await readOctopodActivationTransaction(target)
    if (!transaction) {
      // An unjournaled fence may be a transaction starting or an interrupted release.
      return (await octopodActivationFenceExists(target))
        ? { state: 'keep-all' }
        : { state: 'pinned', dirNames: [] }
    }
    return { state: 'pinned', dirNames: octopodInstallDirNames(transactionVersions(transaction)) }
  } catch (error) {
    if (isUnconfirmedSshCommandTermination(error)) {
      throw error
    }
    return { state: 'keep-all' }
  }
}
