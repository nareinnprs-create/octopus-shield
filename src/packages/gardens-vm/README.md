# Shield Gardens VM

Isolated per-engagement VM environments (EXPANSION_PLAN §1 #12): SPAR digital-twin targets and untrusted-tool detonation. Scope-authorized VM lifecycle over pluggable backends, mirroring `@shield/armory` conventions (deny-by-default scope, audit-shaped records, injected transport).

Import from `@shield/gardens-vm` or explicit subpaths: `./vm-backend`, `./vm-backend-qemu`, `./vm-backend-hyperv`, `./vm-backend-vz`, `./vm-images`, `./gardens-vm`, `./gardens-vm-cli`. The `shield-source` condition exposes `src`, mirroring `@shield/process-host`.

## Backends

| Backend  | Host            | Status on the dev box (2026-10-28)                                                                                                                                    |
| -------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qemu`   | any             | **available** — QEMU 11.1.0, portable install at `C:\Users\manag\tools\qemu-portable\qemu` (see below)                                                                |
| `hyperv` | Windows + admin | unavailable — `vmcompute` runs but the session is not elevated and the Hyper-V feature is off; `available()` reports the honest `service=Running admin=False` verdict |
| `vz`     | macOS           | unavailable off macOS — interface-conformant stub; the Virtualization.framework Swift helper is out of scope for this pass                                            |

Selection order is `qemu → hyperv → vz` (`gardens-vm-backends.ts`); first `available()` wins. Discovery probes `OSHIELD_QEMU_SYSTEM_BIN` / `OSHIELD_QEMU_IMG_BIN`, then PATH, then `C:\Program Files\qemu\`.

Windows install note: `winget install SoftwareFreedomConservancy.QEMU` (the `Software.QEMU` id does not exist) needs an interactive UAC elevation. Headless fallback: download the same winget-verified artifact `https://qemu.weilnetz.de/w64/2026/qemu-w64-setup-20260811.exe` (sha256 `F98A8AEB5F7FAEA9765B6DEE28316C266CD179D80354A2FED8E50176F9A2E59F`) and `7z x` it into a user-writable dir; no admin required.

## Scope authorization

Every lifecycle op is gated by `OSHIELD_GARDENS_SCOPE` — comma-separated VM-name prefixes for the current engagement. A VM named `eng-7-det` is authorized when any prefix equals the name or is followed by `-`. Unset/empty scope authorizes nothing (deny-by-default, same stance as `OSHIELD_ARMORY_SCOPE`). Ops dir defaults to `%TEMP%\oshield\gardens-vm`; override with `OSHIELD_GARDENS_VM_DIR`.

Every executed op (and every backend failure) returns a record plus an audit event shaped like `@shield/armory`'s `armoryRunAuditEvent` (`actorKind: 'tentacle'`, `action: gardens.vm.<op>`).

## Images

`vm-images.ts` pins two entries with upstream SHA256 digests (read 2026-10-28):

- `alpine-virt` — alpine-virt-3.24.3-x86_64.iso, pin from the official `*.iso.sha256`; boot-tested headless (getty banner on serial within the 120 s window under QEMU).
- `ubuntu-cloud` — noble-server-cloudimg-amd64.img, pin from `cloud-images.ubuntu.com/noble/current/SHA256SUMS`; documented only, needs a cloud-init NoCloud seed to be useful.

Downloads always take an injected `fetchLike` (nothing downloads implicitly); the digest is verified before the file is renamed into place, and mismatches refuse without leaving artifacts.

## CLI

```sh
pnpm --filter @shield/gardens-vm exec tsx --conditions=shield-source src/gardens-vm-cli.ts status
# ... status <name>            (pid/uptime/disk/ports/snapshots; plain `status` = backend matrix)
# ... list | create <name> --image-ref <iso> [--disk 0.25] [--memory 512] [--vcpus 1] [--no-nat] [--ssh]
# ... start <name> | stop <name> [--force] | delete <name> | image-download alpine-virt
# ... snapshot <name> <id> | list-snapshots <name> | rollback <name> <id>
```

`stop` defaults to ACPI powerdown via QMP (`system_powerdown`, 30 s patience) and `--force` uses `taskkill /T /F` (Windows) or SIGKILL. `delete` refuses while a VM runs. QEMU launches detached (`detached` + `stdio: 'ignore'` + `unref` via `@shield/process-host`'s existing `spawnProcess` — no process-host changes needed), with `-display none`, serial to a per-VM log file, `-pidfile`, QMP on a TCP port, and SSH hostfwd from 127.0.0.1:2222+ (ports allocated from live garden metadata).

`--ssh` reserves the hostfwd port at create time, records it in the garden metadata (`sshRequested`, `sshHostPort`) and prints it; every `start` reuses the recorded port. The forward target is guest port 22 only — guests must run sshd themselves; no guest provisioning is performed.

Snapshots are **qcow2 internal snapshots** (`qemu-img snapshot -c <id> <disk>`), listed via `qemu-img snapshot -l` (QEMU 11.1 has no `--output=json` for snapshots, so the human table is parsed by `parseQemuImgSnapshotList`), and applied via `snapshot -a`. Snapshot and rollback refuse while the VM is running (the image is locked and a live rollback would corrupt guest state); duplicate ids are refused app-side before shelling out. Ids must match `^[A-Za-z0-9._-]{1,64}$`.

Availability probing never throws: a crashed probe (missing qemu binary → spawn ENOENT) becomes an honest `available: false` verdict with the error as the reason, so lifecycle ops degrade to `DENIED — no gardens VM backend available` instead of crashing the CLI.

## Smoke evidence (2026-10-28, this box)

- qemu-img 11.1.0 / qemu-system-x86_64 11.1.0 from the portable install above.
- `image-download alpine-virt`: 70,254,592 bytes, sha256 pin verified in-process.
- `create smoke-alpine0 --image-ref <iso> --disk 0.25 --memory 512` → `qemu-img create` 268435456-byte qcow2.
- `start smoke-alpine0` → detached pid confirmed via `-pidfile`; serial log reached `Welcome to Alpine Linux 3.24 / Kernel 6.18.58-0-virt on x86_64 (/dev/ttyS0)` → `localhost login:` within the 120 s window.
- `stop --force` retired the pid (taskkill), `delete` removed disk + metadata + logs; `list` reports 0 garden VMs in scope; no orphan qemu processes remain.

## ACPI stop + snapshot evidence (2026-10-29, this box, garden `acpi-test`)

- `create acpi-test --image-ref <iso> --disk 0.25 --memory 512 --ssh` → hostfwd `127.0.0.1:2222` reserved at create, recorded in metadata, printed.
- `start` → login prompt on serial at 26–47 s; `status acpi-test` showed `pid <n> (alive)`, live `uptime`, both ports, and disk size.
- Direct QMP transcript against the running guest: `qmp_capabilities` → `{"return":{}}`, `query-status` → `running`, `system_powerdown` → QEMU raised `event: POWERDOWN` and answered `{"return":{}}`, `query-status` 800 ms later → **still `running`**. The alpine-virt ISO guest has no acpid, so it drops the ACPI power-button event.
- `stop` (no `--force`) at the login prompt failed honestly after the full 30 s patience (32.1 s wall): `acpi powerdown did not retire qemu pid <n> within 30s; use force`. **Gap, kept honest: graceful guest shutdown requires guest-side provisioning (acpid/cloud-init) which is out of scope; `--force` is the reliable retire path (taskkill, <1 s in-record).**
- `rollback` while running refused (`exit 3`, no qemu-img spawn). After force-stop: `snapshot acpi-test base` and `pre-update` (`qemu-img snapshot -c`, ~0.4 s each), duplicate id refused, `list-snapshots` parsed both rows from the QEMU human table, `rollback acpi-test base` applied (`qemu-img snapshot -a`, 179 ms) with both snapshots surviving.
- `delete` cleaned disk + metadata + logs; no orphan qemu processes remained.
