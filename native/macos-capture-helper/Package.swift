// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AutoDemoCaptureHelper",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AutoDemoCaptureCore", targets: ["AutoDemoCaptureCore"]),
        .executable(name: "AutoDemoCaptureHelper", targets: ["AutoDemoCaptureHelper"]),
    ],
    targets: [
        .target(name: "AutoDemoCaptureCore"),
        .executableTarget(
            name: "AutoDemoCaptureHelper",
            dependencies: ["AutoDemoCaptureCore"]
        ),
        .testTarget(
            name: "AutoDemoCaptureCoreTests",
            dependencies: ["AutoDemoCaptureCore"]
        ),
    ]
)
