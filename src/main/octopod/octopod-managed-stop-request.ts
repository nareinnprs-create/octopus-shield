import { createHash } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { readNodeFileSyncWithinLimit } from '../../shared/node-bounded-file-reader'
import {
  OCTOPOD_MANAGED_STOP_REQUEST_MAX_BYTES,
  OCTOPOD_MANAGED_STOP_REQUEST_PREFIX,
  OctopodManagedStopRequestSchema,
  type OctopodManagedStopContext,
  type OctopodManagedStopInstance,
  type OctopodManagedStopRequest
} from '../../shared/octopod-stop-request'
import { readOctopodInstanceLockRecord, type OctopodLockRecord } from './octopod-instance-lock'

/** Nonce-scoped paths prevent requests from addressing a previous instance. */
export function octopodManagedStopRequestPath(instance: OctopodManagedStopInstance): string {
  const digest = createHash('sha256').update(instance.nonce).digest('hex')
  return join(dirname(instance.lockPath), `${OCTOPOD_MANAGED_STOP_REQUEST_PREFIX}.${digest}`)
}

export function readOctopodManagedStopRequest(path: string): OctopodManagedStopRequest {
  if (!lstatSync(path).isFile()) {
    throw new Error('octopod_managed_stop_request_not_regular_file')
  }
  const { buffer } = readNodeFileSyncWithinLimit(path, OCTOPOD_MANAGED_STOP_REQUEST_MAX_BYTES)
  return OctopodManagedStopRequestSchema.parse(JSON.parse(buffer.toString('utf8')))
}

function sameOctopodManagedStopInstance(
  left: OctopodManagedStopInstance,
  right: Pick<OctopodManagedStopInstance, 'pid' | 'startedAtMs' | 'nonce'>
): boolean {
  return (
    left.pid === right.pid && left.startedAtMs === right.startedAtMs && left.nonce === right.nonce
  )
}

export function octopodInstanceLockNames(instance: OctopodManagedStopInstance): boolean {
  return readOctopodInstanceLockNaming(instance) !== null
}

export function readOctopodInstanceLockNaming(
  instance: OctopodManagedStopInstance
): OctopodLockRecord | null {
  if (!lstatSync(instance.lockPath).isFile()) {
    return null
  }
  const record = readOctopodInstanceLockRecord(instance.lockPath)
  return record !== null && sameOctopodManagedStopInstance(instance, record) ? record : null
}

export function validateOctopodManagedStopRequest(
  context: OctopodManagedStopContext,
  requestPath: string
): OctopodManagedStopRequest {
  const request = readOctopodManagedStopRequest(requestPath)
  if (
    request.version !== context.version ||
    request.runtimeId !== context.runtimeId ||
    // Windows clients and servers may use different separators for the same lock.
    resolve(request.instance.lockPath) !== resolve(context.instance.lockPath) ||
    !sameOctopodManagedStopInstance(request.instance, context.instance)
  ) {
    throw new Error('octopod_managed_stop_request_identity_mismatch')
  }
  if (!octopodInstanceLockNames(context.instance)) {
    throw new Error('octopod_managed_stop_instance_lock_changed')
  }
  return request
}
