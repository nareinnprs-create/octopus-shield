# Shield octopod

The `octopod` daemon: composes the `@shield/ganglion` registry with `@shield/engine-contracts` endpoint configuration, probes the live engine fabric, and routes event flow over NATS (`oshield.octopod.*` subjects). The structural `OctopodEventBus` seam stays transport-free — the `nats` client rides only in `./nats-event-bus`, and tests inject fakes through `NatsConnectionLike`.

## Surfaces

- `octopodMain(deps)` (`./octopod-main`) — composition: seeds the 7 locked Tentacles, resolves `OSHIELD_*` endpoints, returns a daemon with `startHealthLoop()` / `stop()`.
- `ENGINE_PROBE_DESCRIPTORS` (`./engine-probes`) — live-verified probe behaviors: Caldera `/api/v2/health` 401-expected-without-key (any response = reachable), Wazuh root 401-without-auth (any response), Mythic `/graphql/` 200, NATS `/healthz` 200. Any HTTP response is the evidence; nothing else.
- `NatsEventBus` (`./nats-event-bus`) — `OctopodEventBus` over NATS core pub/sub (at-most-once telemetry). Envelope: `{ type, payload, occurredAtEpochMs }`; malformed frames surface through `onPumpError` without killing the pump. Disconnect/reconnect is the `nats` client library's job.
- `createLocalOctopodEventBus` (`./local-event-bus`) — in-process bus for tests and `--once`.
- `octopod` CLI (`./octopod-cli`, bin entry).

## Running

```
pnpm --filter @shield/octopod once                  # single probe pass, prints table, exit 0 only if all healthy
node dist/octopod-cli.js                            # daemon: NATS events + 30s health loop
node dist/octopod-cli.js --lifetime-ms=9000         # daemon with cross-platform graceful stop (Windows cannot deliver SIGINT)
```

Probe transport (`./node-probe-fetch`) uses `node:http`/`node:https` with trust checks off for the self-signed localhost engine fabric (global fetch rejects those certs); strict transport policy stays with the real engine clients.
