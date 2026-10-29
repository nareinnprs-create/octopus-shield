/// Bundle ids of the apps whose computer-use sidecar may drive this helper.
public enum TrustedShieldApplication {
    public static func isTrusted(bundleId: String) -> Bool {
        // Why: `pnpm dev` launches as `app.octopusshield.desktop.dev` and per-worktree wrapper apps use
        // `app.octopusshield.desktop.dev.<name>`; the sidecar peer check must authorize both (#26498).
        bundleId == "app.octopusshield.desktop" ||
            bundleId == "app.octopusshield.desktop.dev" ||
            bundleId.hasPrefix("app.octopusshield.desktop.dev.") ||
            bundleId == "com.github.Electron"
    }
}
