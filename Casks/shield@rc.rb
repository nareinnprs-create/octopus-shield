cask "shield@rc" do
  arch arm: "arm64", intel: "x64"

  version "1.4.36-rc.3"
  sha256 arm:   "563b6b14323fc9d5489299c82442d514bc12cabffc9d06d3964ed572af4b3955",
         intel: "457088c7021f07de1a419197f7b2bd00092741ad4727d4fef3d86af38a6831e7"

  url "https://github.com/octopusshield/octopus-shield/releases/download/v#{version}/shield-macos-#{arch}.dmg"
  name "Shield RC"
  desc "IDE for orchestrating AI coding agents across terminals and worktrees"
  homepage "https://octopusshield.invalid/"

  livecheck do
    url "https://github.com/octopusshield/octopus-shield"
    regex(/^v?(\d+(?:\.\d+)+-rc\.\d+)$/i)
    strategy :github_releases do |json, regex|
      json.map do |release|
        next if release["draft"]
        next unless release["prerelease"]

        match = release["tag_name"]&.match(regex)
        next if match.blank?

        match[1]
      end
    end
  end

  # Use Shield’s prerelease-aware updater between frequent RCs.
  auto_updates true
  conflicts_with cask: "shield"
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
