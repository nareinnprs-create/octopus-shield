import { NODE_RUNTIME_PIN } from './node-runtime-pin'
import type { OctopodPreflightRuntimeIdentity } from './octopod-profile-preflight'

/** What a Node slot's candidate must report: the pinned runtime, never a host Node. */
export const OCTOPOD_NODE_RUNTIME_IDENTITY: OctopodPreflightRuntimeIdentity = {
  runtime: 'node',
  runtimeVersion: NODE_RUNTIME_PIN.version
}
