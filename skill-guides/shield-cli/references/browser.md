# Built-in browser commands

Use a snapshot-interact-re-snapshot loop:

```text
SHIELD goto --url https://example.com --json
SHIELD snapshot --json
SHIELD click --element @e3 --json
SHIELD snapshot --json
```

Common commands:

```text
SHIELD goto --url <url> --json
SHIELD back --json
SHIELD reload --json
SHIELD snapshot --json
SHIELD screenshot --json
SHIELD full-screenshot --json
SHIELD pdf --json
SHIELD click --element <ref> --json
SHIELD fill --element <ref> --value <text> --json
SHIELD type --input <text> --json
SHIELD select --element <ref> --value <value> --json
SHIELD check --element <ref> --json
SHIELD scroll --direction down --amount 1000 --json
SHIELD hover --element <ref> --json
SHIELD focus --element <ref> --json
SHIELD keypress --key Enter --json
SHIELD upload --element <ref> --files <paths> --json
SHIELD wait --text <text> --json
SHIELD wait --url <substring> --json
SHIELD wait --selector <css> --json
SHIELD wait --load networkidle --json
SHIELD eval --expression <js> --json
SHIELD tab list --json
SHIELD tab create --url <url> --json
SHIELD tab switch --index <n> --json
SHIELD tab close --index <n> --json
SHIELD cookie get --json
SHIELD capture start --json
SHIELD console --limit 50 --json
SHIELD network --limit 50 --json
SHIELD exec --command "help" --json
```

Browser rules:

- Re-snapshot after navigation, tab switches, clicks that change the page, and any `browser_stale_ref`.
- Refs like `@e1` are assigned by `snapshot`, scoped to one tab, and invalidated by navigation or tab switch.
- Browser commands default to the current worktree and its active tab. Use `--worktree all` only intentionally.
- For concurrent browser work, run `SHIELD tab list --json`, read `tabs[].browserPageId`, and pass `--page <browserPageId>` on later commands.
- Use typed tab commands (`SHIELD tab list/create/close/switch`), not `SHIELD exec --command "tab ..."`, so Shield keeps UI state synchronized.
- Prefer `wait --text`, `--url`, `--selector`, or `--load` after async page changes instead of bare timeouts.
- Anything not listed above goes through `SHIELD exec --command "<agent-browser command>"`.
- If `fill` or `type` fails on a custom input, try `SHIELD focus --element @e1 --json` then `SHIELD inserttext --text "text" --json`.
- A client-hosted page renders in the paired desktop's browser engine, so every command against it needs that desktop online and returns `browser_host_unavailable` while it is closed, asleep, or disconnected. Server-hosted pages run with no desktop attached; prefer them for long or unattended automation.

Common recoveries:

- `browser_no_tab`: open a tab with `SHIELD tab create --url <url> --json`.
- `browser_stale_ref`: run `SHIELD snapshot --json` and retry with fresh refs.
- `browser_tab_not_found`: run `SHIELD tab list --json` before switching or closing.
- `browser_host_unavailable`: the desktop hosting the page is offline. Bring it back, or recreate the page with server placement if the work must outlive the desktop session.
