export const OCTOPOD_PAIRING_REPAIR_FAILED_CODE = 'octopod_pairing_repair_failed'

export class OctopodManagedPairingRepairFailedError extends Error {
  readonly code = OCTOPOD_PAIRING_REPAIR_FAILED_CODE
  constructor(reason: string) {
    super(
      `${OCTOPOD_PAIRING_REPAIR_FAILED_CODE}: the Shield server on this host no longer accepts this ` +
        `computer, and Shield couldn't pair with it again over SSH: ${reason}. Nothing on the host ` +
        `was stopped; its terminals can't be verified until Shield pairs again. Connect again to retry.`
    )
    this.name = 'OctopodManagedPairingRepairFailedError'
  }
}
