import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: "Prepare a WSL pane's Shield-managed Codex home before a shell launch",
    usage: 'shield agent hooks prepare-codex',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Shield-managed agent status hooks are enabled',
    usage: 'shield agent hooks status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['shield agent hooks status', 'shield agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Shield-managed agent status hooks and remove local hook entries',
    usage: 'shield agent hooks off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['shield agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Shield-managed agent status hooks',
    usage: 'shield agent hooks on [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['shield agent hooks on']
  }
]
