import Testing
@testable import ShieldComputerUseMacOSCore

@Suite("TrustedShieldApplication")
struct TrustedShieldApplicationTests {
    @Test("trusts the packaged app, every dev build and stock Electron")
    func trusted() {
        #expect(TrustedShieldApplication.isTrusted(bundleId: "app.octopusshield.desktop"))
        // What `pnpm dev` launches as: DEV_BUNDLE_ID in dev-electron-bundle-identity.mjs (#26498).
        #expect(TrustedShieldApplication.isTrusted(bundleId: "app.octopusshield.desktop.dev"))
        #expect(TrustedShieldApplication.isTrusted(bundleId: "app.octopusshield.desktop.dev.worktree"))
        #expect(TrustedShieldApplication.isTrusted(bundleId: "com.github.Electron"))
    }

    @Test("rejects look-alike and unrelated bundle ids")
    func untrusted() {
        #expect(!TrustedShieldApplication.isTrusted(bundleId: "app.octopusshield.desktop.devtools"))
        #expect(!TrustedShieldApplication.isTrusted(bundleId: "app.octopusshield.desktopx"))
        #expect(!TrustedShieldApplication.isTrusted(bundleId: "com.example.shield"))
        #expect(!TrustedShieldApplication.isTrusted(bundleId: ""))
    }
}
