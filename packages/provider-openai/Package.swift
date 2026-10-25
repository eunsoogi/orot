// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "OpenAIProvider",
    platforms: [
        .iOS(.v15),
        .macOS(.v13),
    ],
    products: [
        .library(name: "OpenAIProvider", targets: ["OpenAIProvider"]),
    ],
    dependencies: [
        .package(url: "https://github.com/vapor/jwt-kit.git", exact: "5.6.0"),
    ],
    targets: [
        .target(
            name: "OpenAIProvider",
            dependencies: [
                .product(name: "JWTKit", package: "jwt-kit"),
            ],
        ),
        .testTarget(
            name: "OpenAIProviderTests",
            dependencies: [
                "OpenAIProvider",
                .product(name: "JWTKit", package: "jwt-kit"),
            ],
            resources: [.process("Fixtures")],
        ),
    ],
)
