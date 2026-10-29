import type { Store } from '../persistence'
import {
  listOctopodMigrationSourceCutovers,
  setOctopodMigrationJournalChangeListener
} from './octopod-migration-cutover-journal'

export function installOctopodMigrationScrollbackRetention(
  userDataPath: string,
  store: Pick<Store, 'syncOctopodMigrationScrollbackRetention'>
): void {
  const sync = (path: string): void => {
    try {
      // Retain bytes until durable commit/abort; closed tabs must still upload on retry.
      const pending = listOctopodMigrationSourceCutovers(path).filter(
        (cutover) => cutover.phase === 'source-fenced' || cutover.phase === 'destination-staged'
      )
      store.syncOctopodMigrationScrollbackRetention(pending.map((cutover) => cutover.manifest))
    } catch (error) {
      // An unreadable journal keeps whatever is held; releasing on a guess could lose bytes.
      console.warn('[octopod-migration] Could not sync scrollback retention:', error)
    }
  }
  setOctopodMigrationJournalChangeListener(sync)
  sync(userDataPath)
}
