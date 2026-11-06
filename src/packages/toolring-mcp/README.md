# @shield/toolring-mcp

MCP (Model Context Protocol) server that exposes the Armory toolring to any MCP client (Arakan, Claude, ...) over newline-delimited JSON-RPC 2.0 on stdio. Node stdlib only — zero dependencies, no build step.

## Run

```sh
node src/index.cjs --rings-dir ./resources/armory/inventory
```

`--rings-dir` defaults to `./resources/armory/inventory` (resolved against cwd). Each `*.json` ring file there is an array of `{ id, runtime, status, notes }` entries; every entry becomes an MCP tool.

## Protocol

| Method       | Behavior                                                                 |
| ------------ | ------------------------------------------------------------------------ |
| `initialize` | `protocolVersion 2025-06-18`, `capabilities.tools`, `serverInfo`         |
| `ping`       | `{}`                                                                     |
| `tools/list` | Catalog built from the rings dir (malformed files/entries skipped)       |
| `tools/call` | **Stub** — returns `structuredContent.status: "requires-armory-runtime"` |
| unknown      | `-32601`                                                                 |

Notifications (no `id`) never produce a response.

## Test

```sh
npm test   # node --test src/ — no install needed
```

## Roadmap

1. **Armory runner bridge**: replace the `tools/call` stub by invoking `@shield/armory`'s `tool-runner` (resolve the workspace dep at that point; drop the relative-source coupling).
2. **Scope env**: gate `tools/list` and `tools/call` end to end via scope configuration (mirroring armory `tool-scope`), reject out-of-scope calls with structured errors.
3. **Discovery state**: only advertise tools whose ring entry is discovered, and surface `requiresDiscovery` setup hints in tool metadata.
4. **Arakan registration**: add the server to Arakan's MCP client config (`node <repo>/src/packages/toolring-mcp/src/index.cjs --rings-dir <resources>/armory/inventory`).
5. Optional: switch to `@modelcontextprotocol/sdk` if we need resources/prompts or transports beyond stdio.
