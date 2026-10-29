---
name: shield-emulator
description: >-
  iOS Simulator control from inside Shield, with the live device view in Shield's
  emulator pane. Use when driving a booted Apple Simulator on macOS: taps,
  gestures, typing, hardware buttons, rotation, and the accessibility tree, or
  when an iOS change needs simulator evidence. For an Android device or emulator
  use the Android emulator skill; build and install the app with xcodebuild or
  simctl first.
license: Apache-2.0
---

# Shield Emulator

This discovery stub loads the version-matched guide from the Shield executable used for this session.

Prefer Shield over raw `serve-sim` or direct `simctl` for simulator control inside Shield; it
handles device scoping, helper lifecycle, and worktree context.

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
SHIELD skills get shield-emulator
```

Prefer `--json`. Use the selected executable's `--help` for commands or flags the guide does
not cover. If a command reports that Shield is not running, start it with `SHIELD open --json`
and retry. If it fails with `runtime_access_denied`, your sandbox blocked the connection:
re-run it with escalated permissions, and do not run `SHIELD open` or restart Shield. If
`skills get` is unknown, explain that updating Shield restores the guide; use `--help` for
read-only discovery and do not guess unsupported commands.
