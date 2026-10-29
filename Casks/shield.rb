cask "shield" do
  arch arm: "arm64", intel: "x64"

  version "1.3.24"
  sha256 arm:   "fc707f290ff3b631b7b7947bf339885b61a43d2e89475997c125b61268ed4966",
         intel: "5f677c13a08f7a5740442e29d388285a86488c8c1f7aa5f10a8721a2c6ede8e4"

  url "https://github.com/octopusshield/octopus-shield/releases/download/v#{version}/shield-macos-#{arch}.dmg"
  name "Shield"
  desc "IDE for orchestrating AI coding agents across terminals and worktrees"
  homepage "https://octopusshield.invalid/"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Let the in-app updater own updates; Homebrew skips auto_updates unless --greedy.
  auto_updates true
  conflicts_with cask: "shield@rc"
  depends_on macos: :big_sur

  app "Shield.app"

  # Expose the symlink-resolving bundled CLI on PATH so headless hosts can use shield serve without the in-app installer.
  binary "#{appdir}/Shield.app/Contents/Resources/bin/shield"

  # Zap app-created ~/.shield and Electron userData for a clean uninstall.
  zap trash: [
    "~/.shield",
    "~/Library/Application Support/Shield",
    "~/Library/Caches/app.octopusshield.desktop",
    "~/Library/Caches/app.octopusshield.desktop.ShipIt",
    "~/Library/HTTPStorages/app.octopusshield.desktop",
    "~/Library/Preferences/app.octopusshield.desktop.plist",
    "~/Library/Saved Application State/app.octopusshield.desktop.savedState",
  ]
end
