# Shield ganglion

Domain vocabulary and pure graph queries for the agent graph. A Tentacle is an agent sub-team (Archivist, Scaffold, Forge, Inkwell, Prism, Sentinal-7, Verifier); the Ganglion is the graph of their agents. Owns types plus pure build/query functions only — no runtime process management, no engine clients.

Import from `@shield/ganglion`; subpaths `./tentacle`, `./ganglion-graph`, `./ganglion-registry`, and `./runtime` expose the same modules individually. Follows the `@shield/process-host` conventions: CommonJS output for both import and require callers, `shield-source` condition for source-loaded tooling, Node 18 floor.

## Runtime (`./runtime`)

`GanglionRuntime` is the head orchestrator ("The Octopus"): it reserves a task node plus a `delegates` edge in the graph per spawn, delegates execution through an injected `SubagentExecutor` (the shell's real agent-session infrastructure plugs in there — no process is ever spawned by this package), enforces a per-Tentacle concurrency cap (default 1) with FIFO overflow queues, and settles the graph via `onComplete(sessionId, result)`. Every transition emits an event (`ganglion.tentacle.spawned`, `ganglion.task.queued`, `ganglion.task.completed` — enrolled in octopod's `OctopodEventMap`) and an armory-shaped audit record (`actorId: 'ganglion-runtime'`). `ganglion-runtime-cli.ts` (`status` / `spawn <tentacle> <title>`) proves the wiring with a NOOP executor.
