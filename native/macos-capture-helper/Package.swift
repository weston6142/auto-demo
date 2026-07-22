// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AutoDemoCaptureHelper",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AutoDemoCaptureCore", targets: ["AutoDemoCaptureCore"]),
    ],
    targets: [
        .target(name: "AutoDemoCaptureCore"),
        .testTarget(
            name: "AutoDemoCaptureCoreTests",
            dependencies: ["AutoDemoCaptureCore"]
        ),
    ]
)
