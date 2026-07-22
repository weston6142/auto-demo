import Darwin
import Foundation
import XCTest
@testable import AutoDemoCaptureCore

final class CaptureLaunchProtocolTests: XCTestCase {
    func testLoadsPrivateVersionProbeRequest() throws {
        let fixture = try LaunchRequestFixture(mode: .version)
        defer { fixture.cleanup() }

        let loaded = try loadPrivateCaptureLaunchRequest(path: fixture.requestPath)

        XCTAssertEqual(loaded.request.protocolVersion, captureProtocolVersion)
        XCTAssertEqual(loaded.request.mode, .version)
        XCTAssertEqual(loaded.request.responsePath, fixture.responsePath)
        XCTAssertNil(loaded.request.bootstrapPath)
    }

    func testRejectsWorldReadableRequest() throws {
        let fixture = try LaunchRequestFixture(mode: .permissionPreflight, requestMode: 0o644)
        defer { fixture.cleanup() }

        XCTAssertThrowsError(try loadPrivateCaptureLaunchRequest(path: fixture.requestPath))
    }

    func testRejectsSymlinkedRequest() throws {
        let fixture = try LaunchRequestFixture(mode: .permissionRequest)
        defer { fixture.cleanup() }
        let symlinkPath = fixture.requestPath + ".link"
        try FileManager.default.createSymbolicLink(atPath: symlinkPath, withDestinationPath: fixture.requestPath)

        XCTAssertThrowsError(try loadPrivateCaptureLaunchRequest(path: symlinkPath))
    }

    func testRejectsProbeResponseOutsidePrivateRequestDirectory() throws {
        let fixture = try LaunchRequestFixture(mode: .permissionRequest, externalResponse: true)
        defer { fixture.cleanup() }

        XCTAssertThrowsError(try loadPrivateCaptureLaunchRequest(path: fixture.requestPath))
    }

    func testRejectsServiceRequestWithoutPrivateBootstrap() throws {
        let fixture = try LaunchRequestFixture(mode: .service, createBootstrap: false)
        defer { fixture.cleanup() }

        XCTAssertThrowsError(try loadPrivateCaptureLaunchRequest(path: fixture.requestPath))
    }

    func testWritesOneBoundedResponseWithoutReplacingExistingPath() throws {
        let fixture = try LaunchRequestFixture(mode: .version)
        defer { fixture.cleanup() }
        let result = CaptureLaunchResult.success(code: "capture_helper_version", values: [
            "protocolVersion": .integer(captureProtocolVersion),
            "bundleIdentifier": .string("com.autodemo.capture-helper"),
        ])

        try writePrivateCaptureLaunchResult(result, path: fixture.responsePath)

        XCTAssertEqual(try loadPrivateCaptureLaunchResult(path: fixture.responsePath), result)
        XCTAssertThrowsError(try writePrivateCaptureLaunchResult(result, path: fixture.responsePath))
        var metadata = stat()
        XCTAssertEqual(lstat(fixture.responsePath, &metadata), 0)
        XCTAssertEqual(metadata.st_mode & 0o777, 0o600)
    }
}

private final class LaunchRequestFixture {
    let directory: String
    let requestPath: String
    let responsePath: String

    init(
        mode: CaptureLaunchMode,
        requestMode: mode_t = 0o600,
        externalResponse: Bool = false,
        createBootstrap: Bool = true
    ) throws {
        directory = try FileManager.default.url(
            for: .itemReplacementDirectory,
            in: .userDomainMask,
            appropriateFor: FileManager.default.temporaryDirectory,
            create: true
        ).path
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o700],
            ofItemAtPath: directory
        )
        requestPath = directory + "/request.json"
        responsePath = externalResponse
            ? FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).path
            : directory + "/response.json"
        let bootstrapPath = directory + "/bootstrap.json"
        if mode == .service, createBootstrap {
            try Data("{}\n".utf8).write(to: URL(fileURLWithPath: bootstrapPath), options: .withoutOverwriting)
            try FileManager.default.setAttributes(
                [.posixPermissions: 0o600],
                ofItemAtPath: bootstrapPath
            )
        }
        let request = CaptureLaunchRequest(
            protocolVersion: captureProtocolVersion,
            mode: mode,
            responsePath: mode == .service ? nil : responsePath,
            bootstrapPath: mode == .service ? bootstrapPath : nil
        )
        let data = try JSONEncoder().encode(request)
        try data.write(to: URL(fileURLWithPath: requestPath), options: .withoutOverwriting)
        try FileManager.default.setAttributes(
            [.posixPermissions: NSNumber(value: requestMode)],
            ofItemAtPath: requestPath
        )
    }

    func cleanup() {
        try? FileManager.default.removeItem(atPath: directory)
        if !responsePath.hasPrefix(directory + "/") {
            try? FileManager.default.removeItem(atPath: responsePath)
        }
    }
}
