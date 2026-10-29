import { shieldSessionAddressSql } from '../shield-session-address-sql'
import type { ShieldSessionId } from '../../../../../shared/shield-session-address'
import type { RunRow } from '../../types'

type RunCoordinatorShieldSessionFields = Pick<
  RunRow,
  'coordinator_shield_session_id' | 'coordinator_shield_session_id_generation' | 'consumer_generation'
>

/** Count a coordinator session id only at its stamped consumer generation; older writers bump generation without clearing it. */
export function currentRunCoordinatorShieldSessionId(
  run: RunCoordinatorShieldSessionFields
): ShieldSessionId | null {
  return run.coordinator_shield_session_id_generation === run.consumer_generation
    ? run.coordinator_shield_session_id
    : null
}

/** The same rule in SQL, for a `runs` row named `row` (a table name, alias, or `NEW`). */
export function currentRunCoordinatorShieldSessionIdSql(row: string): string {
  return `(CASE WHEN ${row}.coordinator_shield_session_id_generation = ${row}.consumer_generation
    THEN ${row}.coordinator_shield_session_id END)`
}

/** The coordinator's `shield_session_id:<id>` address in SQL; NULL when it has no current Shield session id. */
export function currentRunCoordinatorSessionAddressSql(row: string): string {
  return shieldSessionAddressSql(currentRunCoordinatorShieldSessionIdSql(row))
}
