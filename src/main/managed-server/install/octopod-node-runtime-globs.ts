import {
  OCTOPOD_NODE_RUNTIME_DIR_PREFIX,
  OCTOPOD_NODE_RUNTIME_POSIX_EXECUTABLE,
  OCTOPOD_RUNTIMES_DIRNAME
} from '../../../shared/octopod-artifacts'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { RELAY_REMOTE_DIR } from '../../ssh/remote-exec/remote-frame-protocol'
import { OCTOPOD_MACHINE_HOMES_DIRNAME } from '../host-state/octopod-machine-home'

/** POSIX shell glob words for octopod's pinned Node runtimes; machine homes may hold other architectures, so callers must self-test each match. */
export function octopodPosixNodeRuntimeGlobs(): [string, string] {
  const store = `${RELAY_REMOTE_DIR}/${OCTOPOD_RUNTIMES_DIRNAME}/${OCTOPOD_NODE_RUNTIME_DIR_PREFIX}`
  const executable = `/${OCTOPOD_NODE_RUNTIME_POSIX_EXECUTABLE}`
  const machineStores = `${RELAY_REMOTE_DIR}/${OCTOPOD_MACHINE_HOMES_DIRNAME}/`
  return [
    `"$HOME"/${quotePosixShell(store)}*${quotePosixShell(executable)}`,
    `"$HOME"/${quotePosixShell(machineStores)}*/${quotePosixShell(store)}*${quotePosixShell(executable)}`
  ]
}
