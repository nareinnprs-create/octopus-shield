let listener: (environmentId: string) => void | Promise<void> = () => {}

export function setManagedOctopodPairingRepairedListener(
  next: (environmentId: string) => void | Promise<void>
): void {
  listener = next
}

export function notifyManagedOctopodPairingRepaired(environmentId: string): void | Promise<void> {
  return listener(environmentId)
}
