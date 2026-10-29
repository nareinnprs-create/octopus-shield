// Stage pinned Node and a content-addressed host script so Windows operations share verified bytes without replacing running clients' code.
import { join } from 'node:path'
import { getAppEnvironment } from '../../../shared/app-environment'
import type { NodeRuntimeTarget } from '../../../shared/node-runtime-pin'
import { ensureRemoteOctopodNodeRuntime } from '../install/octopod-remote-node-runtime'
import {
  installOctopodWindowsHostScript,
  octopodRemoteBaseDir
} from '../install/octopod-remote-windows-node'
import { materializeNodeRuntimeArchive } from '../../node-runtime/pinned-runtime-materializer'
import type { OctopodHostTransport } from '../../ssh/octopod-host-transport'
import { joinRemotePath, type RemoteHostPlatform } from '../../ssh/ssh-remote-platform'

export async function prepareWindowsOctopodHost(options: {
  conn: OctopodHostTransport
  host: RemoteHostPlatform
  remoteHome: string
  serverTarget: NodeRuntimeTarget
  signal?: AbortSignal
}): Promise<void> {
  const baseDir = octopodRemoteBaseDir(options.host, options.remoteHome)
  await ensureRemoteOctopodNodeRuntime({
    conn: options.conn,
    host: options.host,
    // The runtime store is a sibling of slots; only this synthetic slot's parent is used.
    slotDir: joinRemotePath(options.host, baseDir, 'octopod-host'),
    target: options.serverTarget,
    archivePath: () =>
      materializeNodeRuntimeArchive(
        options.serverTarget,
        join(getAppEnvironment().getPath('userData'), 'octopod-artifacts'),
        { signal: options.signal }
      ),
    signal: options.signal
  })
  await installOctopodWindowsHostScript(options, baseDir)
}
