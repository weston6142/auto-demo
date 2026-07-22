import Foundation
import XCTest
@testable import AutoDemoCaptureCore

final class CaptureHelperModeTests: XCTestCase {
    func testVersionModeWritesProtocolAndBundleIdentity() async throws {
        let fixture = try HelperModeFixture(mode: .version)
        defer { fixture.cleanup() }
        let service = FakeService()

        try await executeCaptureHelperRequest(
            fixture.request,
            permission: FakePermission(granted: true),
            serve: { path in await service.serve(path) }
        )

        XCTAssertEqual(try fixture.result(), .success(
            code: "capture_helper_version",
            values: [
                "protocolVersion": .integer(captureProtocolVersion),
                "bundleIdentifier": .string("com.autodemo.capture-helper"),
            ]
        ))
        let paths = await service.paths()
        XCTAssertEqual(paths, [])
    }

    func testPermissionPreflightDoesNotPrompt() async throws {
        let fixture = try HelperModeFixture(mode: .permissionPreflight)
        defer { fixture.cleanup() }
        let permission = FakePermission(granted: false)

        try await executeCaptureHelperRequest(
            fixture.request,
            permission: permission,
            serve: { _ in }
        )

        let actions = await permission.actions()
        XCTAssertEqual(actions, [.preflight])
        XCTAssertEqual(try fixture.result().code, "capture_helper_permission_required")
    }

    func testPermissionRequestUsesTheRequestOperation() async throws {
        let fixture = try HelperModeFixture(mode: .permissionRequest)
        defer { fixture.cleanup() }
        let permission = FakePermission(granted: true)

        try await executeCaptureHelperRequest(
            fixture.request,
            permission: permission,
            serve: { _ in }
        )

        let actions = await permission.actions()
        XCTAssertEqual(actions, [.request])
        XCTAssertEqual(try fixture.result().code, "capture_helper_permission_granted")
    }

    func testServiceFailsBeforeSocketWhenPermissionIsMissing() async throws {
        let fixture = try HelperModeFixture(mode: .service)
        defer { fixture.cleanup() }
        let service = FakeService()

        do {
            try await executeCaptureHelperRequest(
                fixture.request,
                permission: FakePermission(granted: false),
                serve: { path in await service.serve(path) }
            )
            XCTFail("expected permissionRequired")
        } catch {
            XCTAssertEqual(error as? CaptureHelperModeError, .permissionRequired)
        }

        let paths = await service.paths()
        XCTAssertEqual(paths, [])
    }

    func testServiceUsesTheValidatedBootstrap() async throws {
        let fixture = try HelperModeFixture(mode: .service)
        defer { fixture.cleanup() }
        let service = FakeService()

        try await executeCaptureHelperRequest(
            fixture.request,
            permission: FakePermission(granted: true),
            serve: { path in await service.serve(path) }
        )

        let paths = await service.paths()
        XCTAssertEqual(paths, [fixture.bootstrapPath])
    }
}

private final class HelperModeFixture: @unchecked Sendable {
    let directory: String
    let responsePath: String
    let bootstrapPath: String
    let request: ValidatedCaptureLaunchRequest

    init(mode: CaptureLaunchMode) throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("capture-helper-mode-\(UUID().uuidString)", isDirectory: true)
            .path
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: false)
        try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: directory)
        responsePath = directory + "/response.json"
        bootstrapPath = directory + "/bootstrap.json"
        if mode == .service {
            try Data("{}\n".utf8).write(to: URL(fileURLWithPath: bootstrapPath))
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: bootstrapPath)
        }
        let requestPath = directory + "/request.json"
        request = ValidatedCaptureLaunchRequest(
            requestPath: requestPath,
            request: CaptureLaunchRequest(
                protocolVersion: captureProtocolVersion,
                mode: mode,
                responsePath: mode == .service ? nil : responsePath,
                bootstrapPath: mode == .service ? bootstrapPath : nil
            )
        )
    }

    func result() throws -> CaptureLaunchResult {
        try loadPrivateCaptureLaunchResult(path: responsePath)
    }

    func cleanup() {
        try? FileManager.default.removeItem(atPath: directory)
    }
}

private enum PermissionAction: Equatable {
    case preflight
    case request
}

private actor FakePermission: CapturePermissionChecking {
    private let granted: Bool
    private var recordedActions: [PermissionAction] = []

    init(granted: Bool) { self.granted = granted }

    func preflight() -> Bool {
        recordedActions.append(.preflight)
        return granted
    }

    func request() -> Bool {
        recordedActions.append(.request)
        return granted
    }

    func actions() -> [PermissionAction] { recordedActions }
}

private actor FakeService {
    private var recordedPaths: [String] = []

    func serve(_ path: String) { recordedPaths.append(path) }
    func paths() -> [String] { recordedPaths }
}
