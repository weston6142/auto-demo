// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "AutoDemoCaptureHelper",
    platforms: [.macOS(.v14)],
    products: [
        .library(name: "AutoDemoCaptureCore", targets: ["AutoDemoCaptureCore"]),
        .executable(name: "AutoDemoCaptureHelper", targets: ["AutoDemoCaptureHelper"]),
        .executable(name: "AutoDemoCaptureSupervisor", targets: ["AutoDemoCaptureSupervisor"]),
    ],
    targets: [
        .target(name: "AutoDemoCaptureCore"),
        .executableTarget(
            name: "AutoDemoCaptureHelper",
            dependencies: ["AutoDemoCaptureCore"]
        ),
        .executableTarget(
            name: "AutoDemoCaptureSupervisor",
            dependencies: ["AutoDemoCaptureCore"]
        ),
        .testTarget(
            name: "AutoDemoCaptureCoreTests",
            dependencies: ["AutoDemoCaptureCore"]
        ),
    ]
)
