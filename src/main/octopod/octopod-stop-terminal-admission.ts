// Hold admission until exit so shutdown cannot miss newly created terminals.
let runningTerminalAdmission: { holdUntilExit(): void } | null = null
// Shutdown can begin before the runtime binds terminal admission.
let stopBegan = false

export function bindOctopodStopTerminalAdmission(admission: { holdUntilExit(): void }): void {
  runningTerminalAdmission = admission
  if (stopBegan) {
    admission.holdUntilExit()
  }
}

export function holdOctopodTerminalAdmissionUntilExit(): void {
  stopBegan = true
  runningTerminalAdmission?.holdUntilExit()
}
