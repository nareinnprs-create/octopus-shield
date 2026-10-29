# Shield engine contracts

Interface-level contracts for the three live engine adapters — Wazuh (endpoint detection / SIEM), Mythic (command & control), Caldera (assault, feeding SPAR) — plus the typed endpoint map for the live engine and nucleus fabric and a pure parser for `OSHIELD_*` configuration environment variables. Clients implementing these interfaces are built elsewhere; this package ships types, defaults, and pure functions only.

Import from `@shield/engine-contracts` or the explicit subpaths (`./engine-endpoints`, `./oshield-env`, `./engine-endpoint-overrides`, `./engine-adapter`, and one contract module per engine). The default endpoint constants mirror the live deployment documented in `infra/README.md`; every value is overridable through the documented `OSHIELD_*` variables.
