# @shield/attack-graph

X1 increment: goal string → ordered ATT&CK-mapped attack-phase plan, matched against the armory ring catalog. Plain `.cjs`, Node stdlib only, `node --test`.

## CLI

```sh
node src/engine.cjs --goal domain_admin --rings-dir ./resources/armory/inventory [--scope 10.0.0.0/24] [--out plan.json]
```

- Default (`--dry-run`): prints the phased plan as JSON, touches nothing.
- `--execute`: requires BOTH `--i-accept-authorized-targets` AND `OSHIELD_ARMORY_SCOPE` set — refuses otherwise (exit 2). Without `--run` it only prints each task's armory command (`mode: "print"`).
- `--run` (with `--execute`): shells out to the armory CLI (`armory run <tool> --targets=<scope> -- <args>`, override binary via `--armory-cli`) sequentially; a non-zero exit stops the chain (HR2: exploit classes still gated by armory itself via `OSHIELD_ARMORY_EXPLOIT_AUTHORIZED`).

## Modules

- `src/goal.cjs` — static heuristic tables: phase order, techniques per phase, per-goal objective techniques, candidate ring tools. Every technique carries its attack.mitre.org URL + `TODO(verify)` (HR4).
- `src/planner.cjs` — pure: plan + ring tools + scope → phased task list; techniques with no ring tool are reported as `missing`, phases with zero tasks as `gap`.
- `src/engine.cjs` — CLI, ring loading, execute gating.

## Roadmap

- X2 (web/AppSec agent) builds on this plan shape: phased tasks + technique provenance feed PoC-verified finding reporting.
- X4: verification oracle re-runs a task's technique with a differential command.
- Technique tables and `TOOL_ARGS` are unvetted planning placeholders (`shortcut:` in source) — verify before trusted `--run` use.
