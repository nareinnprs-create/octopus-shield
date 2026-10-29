import { OSHIELD_SESSION_ADDRESS_PREFIX } from '../../../../shared/shield-session-address'

/** Format bare ids as session addresses (NULL stays NULL); never strip addresses and risk matching handles or Runs. */
export function shieldSessionAddressSql(shieldSessionIdSql: string): string {
  return `('${OSHIELD_SESSION_ADDRESS_PREFIX}' || ${shieldSessionIdSql})`
}
