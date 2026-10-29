// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ShieldComputerUseMacOS",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .library(
            name: "ShieldComputerUseMacOSCore",
            targets: ["ShieldComputerUseMacOSCore"]
        ),
        .executable(
            name: "shield-computer-use-macos",
            targets: ["ShieldComputerUseMacOS"]
        )
    ],
    targets: [
        .target(
            name: "ShieldComputerUseMacOSCore",
            path: "Sources/ShieldComputerUseMacOSCore"
        ),
        .executableTarget(
            name: "ShieldComputerUseMacOS",
            dependencies: ["ShieldComputerUseMacOSCore"],
            path: "Sources/ShieldComputerUseMacOS"
        ),
        .testTarget(
            name: "ShieldComputerUseMacOSTests",
            dependencies: ["ShieldComputerUseMacOSCore"],
            path: "Tests/ShieldComputerUseMacOSTests"
        )
    ]
)
