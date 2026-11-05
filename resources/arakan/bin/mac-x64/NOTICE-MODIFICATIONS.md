# NOTICE — Arakan modifications (Apache-2.0 compliance)

## Origin

- Upstream project: **goose** — https://github.com/aaif-goose/goose
- Base snapshot: commit `bfe8ccd23de1d2c47a4cb2970d522f093ae7f2ba` (tag `arakan-1.0.0-base` on `arakan-main`)
- License: Apache License 2.0 — see `LICENSE` (verbatim, unmodified attribution retained)

## This distribution

Arakan is a **fully detached** custom distribution of goose, maintained independently
by the Octopus Shield project. It is not endorsed by, nor affiliated with, the upstream
goose project or the Agentic AI Foundation.

## Detach policy

- No upstream remote sync. The only retained reference remote has its push URL disabled.
- Updates ship exclusively through the Octopus Shield release channel.

## Modifications made (this distribution differs from upstream)

1. **Telemetry removed at compile time** — the PostHog usage-tracking module
   (`crates/arakan/src/posthog.rs`) and all call sites were deleted; the `telemetry`
   feature now maps only to self-hosted OpenTelemetry observability (never reported upstream).
2. **Self-updater removed** — `crates/arakan-cli/src/commands/update.rs` and the
   `download_cli` scripts were deleted. No network update check exists in this binary.
3. **Full rebrand** — all crate names, binary names, environment variables
   (`GOOSE_*` → `ARAKAN_*`), configuration paths (`~/.config/goose` → `~/.arakan`),
   documentation, prompts, and user-facing strings were renamed to Arakan.
4. Upstream CI trimmed to a dispatch-only binary-release workflow.

## Trademark

"Arakan" and "Octopus Shield" are distinct marks; "goose" remains a trademark of its
respective project and its use here is limited to license attribution.
