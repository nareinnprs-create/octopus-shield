import {
  OCTOPOD_BUILD_TARGET_FILENAME,
  OCTOPOD_LAUNCHER_FILENAME,
  OCTOPOD_SERVER_ENTRY_FILENAME,
  OCTOPOD_NODE_RUNTIME_DIR_PREFIX,
  OCTOPOD_NODE_RUNTIME_MARKER_FILENAME,
  OCTOPOD_NODE_RUNTIME_POSIX_EXECUTABLE,
  OCTOPOD_RUNTIMES_DIRNAME,
  octopodBunRuntimeFilename
} from '../../../shared/octopod-artifacts'
import { assertPosixOctopodHost } from './octopod-remote-host-support'
import { quotePosixShell } from '../../../shared/shell-argument-quoting'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

// Assign the long slot path once to reduce command size on the wire.
function assignOctopodSlot(directory: string): string {
  return `octopod_slot=${quotePosixShell(directory.replace(/\/+$/, ''))}; `
}

// Rollback must still accept legacy single-entry slots.
export function selectOctopodSlotEntryCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixOctopodHost(host)
  const server = `"$octopod_slot"/${quotePosixShell(OCTOPOD_SERVER_ENTRY_FILENAME)}`
  const launcher = `"$octopod_slot"/${quotePosixShell(OCTOPOD_LAUNCHER_FILENAME)}`
  return `${assignOctopodSlot(directory)}if [ -f ${server} ]; then octopod_entry=${server}; else octopod_entry=${launcher}; fi`
}

/** Set $octopod_runtime or exit 78; callers decide what an absent marker means. */
export function octopodNodeSlotRuntimeCommand(host: RemoteHostPlatform, directory: string): string {
  assertPosixOctopodHost(host)
  const nodeMarker = `"$octopod_slot"/${quotePosixShell(OCTOPOD_NODE_RUNTIME_MARKER_FILENAME)}`
  const nodeRuntimePrefix = `"\${octopod_slot%/*}"/${quotePosixShell(
    `${OCTOPOD_RUNTIMES_DIRNAME}/${OCTOPOD_NODE_RUNTIME_DIR_PREFIX}`
  )}`
  const nodeExecutable = quotePosixShell(`/${OCTOPOD_NODE_RUNTIME_POSIX_EXECUTABLE}`)
  return (
    `${assignOctopodSlot(directory)}octopod_node_sha=$(cat ${nodeMarker}) || exit 78; ` +
    // The digest becomes a path segment; reject non-SHA256 values.
    // Leading ( keeps the case pattern parseable inside command substitution.
    'case "$octopod_node_sha" in ("" | *[!0-9a-f]*) exit 78;; esac; ' +
    '[ "${#octopod_node_sha}" -eq 64 ] || exit 78; ' +
    `octopod_runtime=${nodeRuntimePrefix}"$octopod_node_sha"${nodeExecutable}; ` +
    '[ -x "$octopod_runtime" ] || exit 78; '
  )
}

/** Legacy host Node fallback must never hide an incomplete Node or Bun slot. */
export function selectOctopodSlotRuntimeCommand(
  host: RemoteHostPlatform,
  directory: string,
  legacyNodePath: string
): string {
  assertPosixOctopodHost(host)
  const nodeMarker = quotePosixShell(
    joinRemotePath(host, directory, OCTOPOD_NODE_RUNTIME_MARKER_FILENAME)
  )
  const runtime = quotePosixShell(joinRemotePath(host, directory, octopodBunRuntimeFilename(host.os)))
  const target = quotePosixShell(joinRemotePath(host, directory, OCTOPOD_BUILD_TARGET_FILENAME))
  return (
    `if [ -e ${nodeMarker} ]; then ${octopodNodeSlotRuntimeCommand(host, directory)}` +
    `elif [ -e ${target} ] || [ -e ${runtime} ]; then ` +
    `[ -x ${runtime} ] || exit 78; octopod_runtime=${runtime}; ` +
    `else octopod_runtime=${quotePosixShell(legacyNodePath)}; fi`
  )
}
