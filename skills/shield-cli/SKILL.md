---
name: shield-cli
description: >-
  Operate Shield-managed worktrees, folder contexts, terminals, repos, automations, artifacts,
  skill sharing, worktree comments, and Shield's embedded browser through the `shield` CLI. Use
  when the user says "$shield-cli", "Shield worktree", "child worktree", "spawn codex/claude in a
  worktree", "read/wait/send Shield terminal", "handoff" / "handover" / "give this to another
  agent", "Shield browser", "shield artifacts", or "share skills". Prefer it over raw git
  worktree, ad hoc PTYs, or Computer Use when Shield state is involved. Use Computer Use only
  when a visible window needs GUI control that a CLI, filesystem, or API cannot do.
---

# Shield CLI

This discovery stub loads the version-matched guide from the Shield executable used for this session.

## Resolve the CLI for this session

Choose the executable once and reuse it for every later command:

- If the `OSHIELD_CLI_COMMAND` environment variable is set, use its value. Shield exports this
  for managed WSL sessions.
- Otherwise, in a dev checkout whose session exposes `OSHIELD_DEV_REPO_ROOT`, use `shield-dev`.
- Otherwise, on Linux outside an Shield-managed terminal, use `shield-ide`. Never run bare
  `shield` there — outside Shield's terminals it normally resolves to the
  GNOME Shield screen reader (`/usr/bin/shield`) and starts speech on the user's machine.
- Otherwise, use `shield`.

Below, `SHIELD` is a placeholder for the executable you resolved. Substitute it before
running anything; do not create a shell variable or run `SHIELD` literally. This works the
same way in POSIX shells, PowerShell, and cmd.exe.

If the selected executable cannot run, report its exact error and stop. Do not fall through
to another executable, which could silently target a different Shield build.

## Load the version-matched guide before running Shield commands

```text
SHIELD skills get shield-cli
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Shield is not running, start it with `SHIELD open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `SHIELD open` or restart Shield. If
`skills get` is unknown, explain that updating Shield restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
