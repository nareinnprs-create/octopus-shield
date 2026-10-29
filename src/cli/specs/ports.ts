import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const PORTS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['ports'],
    summary: 'List the listening ports Shield detected for a workspace',
    usage: 'shield ports [--worktree <selector>] [--all] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'worktree', 'all'],
    notes: [
      'Defaults to the Shield workspace that contains the current directory.',
      'Scans the host the workspace runs on and lists the ports Shield tied to it, by process working directory (match=cwd) or command line (match=command).',
      '--all lists every listener found on that host, including other workspaces and processes Shield could not tie to one. A native folder workspace needs --all, because Shield does not tie ports to folders.',
      'url is the address the dev server printed in an Shield terminal; it is missing when Shield did not see one.'
    ],
    examples: [
      'shield ports',
      'shield ports --worktree branch:feature/login --json',
      'shield ports --all',
      "shield ports --json | jq -r '.result.ports[0].advertisedUrl'"
    ]
  }
]
