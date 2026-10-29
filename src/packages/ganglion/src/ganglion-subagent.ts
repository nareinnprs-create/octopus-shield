import type { TentacleName } from './tentacle'

/**
 * SubagentExecutor adapter contract for src/main (additive wiring):
 *  - Real agent-session spawn lives at `terminal.createAgentSession` (src/main/ipc/pty);
 *    the ACP child-session lifecycle (prompt turn -> settlement) lives in
 *    src/main/acp/acp-structured-session-adapter.ts + acp-structured-child.ts.
 *  - A thin adapter maps (tentacle, task) to ONE agent session: create the session
 *    through that existing path, send task.prompt as a single prompt turn, await
 *    turn settlement, then resolve `{ sessionId, status: 'completed' | 'failed', detail? }`.
 *  - When the executor resolves, the adapter settles the graph via
 *    `ganglionRuntime.onComplete(sessionId, { status, detail? })` (idempotent).
 *  - Hosts compose: build the runtime over `seedDefaultGanglionRegistry()` and pass it
 *    as octopodMain's optional `ganglionRuntime` dependency (see @shield/octopod).
 */

export type SubagentTask = {
  readonly id: string
  readonly title: string
  readonly prompt: string
}

export type SubagentStatus = 'completed' | 'failed'

export type SubagentResult = {
  status: SubagentStatus
  detail?: string
}

/** Terminal report from one delegated subagent run. */
export type SubagentExecution = SubagentResult & {
  sessionId: string
}

/**
 * Structural seam the shell's agent-session infrastructure plugs into; resolves
 * once the delegated session reaches a terminal state.
 */
export type SubagentExecutor = (
  tentacle: TentacleName,
  task: SubagentTask
) => Promise<SubagentExecution>
