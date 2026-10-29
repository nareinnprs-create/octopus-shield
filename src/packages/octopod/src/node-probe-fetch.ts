import { request as nodeHttpRequest } from 'node:http'
import { request as nodeHttpsRequest } from 'node:https'
import type { OctopodProbeFetchLike } from './engine-probes'

/**
 * Probe transport for the live engine fabric. Engine TLS certs are self-signed — the operator
 * probes of Wazuh 55000 / Mythic 7443 required `curl -k` and Node's global fetch rejects them
 * (UNABLE_TO_VERIFY_LEAF_SIGNATURE, reproduced 2026-10) — so https probes deliberately skip
 * trust checks: an HTTP-layer answer of any kind is the evidence. TLS fronting is a later
 * reverse-proxy job; real (non-probe) engine traffic keeps its strict transport policy.
 */
export function createNodeProbeFetchLike(): OctopodProbeFetchLike {
  return (probeUrl, init) =>
    new Promise((resolve, reject) => {
      const target = new URL(probeUrl)
      if (target.protocol !== 'https:' && target.protocol !== 'http:') {
        reject(new Error(`unsupported probe protocol: ${target.protocol}`))
        return
      }
      const transport = target.protocol === 'https:' ? nodeHttpsRequest : nodeHttpRequest
      const request = transport(probeUrl, { method: 'GET', signal: init?.signal, rejectUnauthorized: false }, (response) => {
        // Drain the body so the socket always closes; the status line is the only evidence needed.
        response.resume()
        if (response.statusCode === undefined || response.statusCode === null) {
          reject(new Error('probe response carried no status line'))
          return
        }
        resolve({ status: response.statusCode })
      })
      request.on('error', (error) => reject(error))
      request.end()
    })
}
