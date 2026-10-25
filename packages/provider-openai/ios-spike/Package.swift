// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ChatGPTOAuthSpikeSupport",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "ChatGPTOAuthSpikeSupport", targets: ["ChatGPTOAuthSpikeSupport"]),
    ],
    targets: [
        .target(
            name: "ChatGPTOAuthSpikeSupport",
            path: "Sources",
            exclude: ["ChatGPTOAuthSpikeApp.swift", "ContentView.swift", "LoopbackCallbackServer.swift"],
            sources: ["AuthorizationCancellationState.swift"],
        ),
        .testTarget(
            name: "ChatGPTOAuthSpikeSupportTests",
            dependencies: ["ChatGPTOAuthSpikeSupport"],
            path: "Tests",
        ),
    ],
)
