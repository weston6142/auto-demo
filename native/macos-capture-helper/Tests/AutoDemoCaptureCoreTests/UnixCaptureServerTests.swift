import Darwin
import Foundation
import XCTest
@testable import AutoDemoCaptureCore

final class UnixCaptureServerTests: XCTestCase {
    func testServesAuthenticatedCurrentUserOverOwnerOnlySocket() async throws {
        let fixture = try ServerFixture()
        defer { fixture.cleanup() }
        let provider = FakeCaptureProvider(png: Data([1, 2, 3, 4]))
        let server = UnixCaptureServer(
            bootstrap: fixture.bootstrap,
            provider: provider,
            maximumRequests: 1
        )
        let task = Task.detached { try await server.run() }
        try await fixture.waitUntilReady()

        XCTAssertEqual(try fixture.socketMode(), 0o600)
        let response = try fixture.request(
            CaptureRequest(
                protocolVersion: captureProtocolVersion,
                token: fixture.token,
                x: 40,
                y: 80,
                width: 320,
                height: 240
            )
        )

        XCTAssertEqual(
            response.header,
            CaptureResponseHeader(
                ok: true,
                code: nil,
                message: nil,
                byteLength: 4,
                width: 320,
                height: 240
            )
        )
        XCTAssertEqual(response.png, Data([1, 2, 3, 4]))
        let capturedRegions = await provider.capturedRegions()
        XCTAssertEqual(capturedRegions, [CGRect(x: 40, y: 80, width: 320, height: 240)])
        try await task.value
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.socketPath))
    }

    func testRejectsWrongTokenBeforeCapture() async throws {
        let fixture = try ServerFixture()
        defer { fixture.cleanup() }
        let provider = FakeCaptureProvider(png: Data([1]))
        let server = UnixCaptureServer(
            bootstrap: fixture.bootstrap,
            provider: provider,
            maximumRequests: 1
        )
        let task = Task.detached { try await server.run() }
        try await fixture.waitUntilReady()

        let response = try fixture.request(
            CaptureRequest(
                protocolVersion: captureProtocolVersion,
                token: String(repeating: "b", count: 64),
                x: 0,
                y: 0,
                width: 10,
                height: 10
            )
        )

        XCTAssertEqual(response.header, .failure(.authenticationFailed))
        XCTAssertTrue(response.png.isEmpty)
        let captureCount = await provider.captureCount()
        XCTAssertEqual(captureCount, 0)
        try await task.value
    }

    func testRejectsInvalidRegionBeforeCapture() async throws {
        let fixture = try ServerFixture()
        defer { fixture.cleanup() }
        let provider = FakeCaptureProvider(png: Data([1]))
        let server = UnixCaptureServer(
            bootstrap: fixture.bootstrap,
            provider: provider,
            maximumRequests: 1
        )
        let task = Task.detached { try await server.run() }
        try await fixture.waitUntilReady()

        let response = try fixture.request(
            CaptureRequest(
                protocolVersion: captureProtocolVersion,
                token: fixture.token,
                x: 0,
                y: 0,
                width: maximumCaptureDimension + 1,
                height: 10
            )
        )

        XCTAssertEqual(response.header, .failure(.invalidRegion))
        let captureCount = await provider.captureCount()
        XCTAssertEqual(captureCount, 0)
        try await task.value
    }

    func testReturnsBoundedProviderFailureDiagnostics() async throws {
        let fixture = try ServerFixture()
        defer { fixture.cleanup() }
        let diagnostic = CaptureFailureDiagnostic(
            stage: .screenshotCapture,
            systemErrorDomain: "SCStreamErrorDomain",
            systemErrorCode: -3812
        )
        let server = UnixCaptureServer(
            bootstrap: fixture.bootstrap,
            provider: FailingCaptureProvider(diagnostic: diagnostic),
            maximumRequests: 1
        )
        let task = Task.detached { try await server.run() }
        try await fixture.waitUntilReady()

        let response = try fixture.request(
            CaptureRequest(
                protocolVersion: captureProtocolVersion,
                token: fixture.token,
                x: 40,
                y: 80,
                width: 320,
                height: 240
            )
        )

        XCTAssertEqual(response.header, .failure(.captureFailed, diagnostic: diagnostic))
        XCTAssertTrue(response.png.isEmpty)
        try await task.value
    }

    func testStopsAfterBoundedIdleTimeout() async throws {
        let fixture = try ServerFixture()
        defer { fixture.cleanup() }
        let server = UnixCaptureServer(
            bootstrap: fixture.bootstrap,
            provider: FakeCaptureProvider(png: Data([1])),
            pollTimeoutOverrideMs: 100
        )

        let started = ContinuousClock.now
        try await server.run()
        XCTAssertLessThan(started.duration(to: .now), .seconds(1))
        XCTAssertFalse(FileManager.default.fileExists(atPath: fixture.socketPath))
    }

    func testNeverRemovesAPathItDidNotCreate() async throws {
        let fixture = try ServerFixture()
        defer { fixture.cleanup() }
        let original = Data("preserve me".utf8)
        try original.write(to: URL(fileURLWithPath: fixture.socketPath), options: .withoutOverwriting)
        let server = UnixCaptureServer(
            bootstrap: fixture.bootstrap,
            provider: FakeCaptureProvider(png: Data([1]))
        )

        do {
            try await server.run()
            XCTFail("server unexpectedly replaced an existing path")
        } catch {
            XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: fixture.socketPath)), original)
        }
    }
}

private actor FakeCaptureProvider: CaptureProvider {
    private var regions: [CGRect] = []
    private let png: Data

    init(png: Data) {
        self.png = png
    }

    func capture(region: CGRect, outputSize: CGSize) async throws -> Data {
        regions.append(region)
        return png
    }

    func capturedRegions() -> [CGRect] {
        regions
    }

    func captureCount() -> Int {
        regions.count
    }
}

private struct FailingCaptureProvider: CaptureProvider {
    let diagnostic: CaptureFailureDiagnostic

    func capture(region: CGRect, outputSize: CGSize) async throws -> Data {
        throw diagnostic
    }
}

private struct ServerFixture {
    let directory: URL
    let socketPath: String
    let token = String(repeating: "a", count: 64)

    init() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("adcs-\(UUID().uuidString.prefix(8))")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        socketPath = directory.appendingPathComponent("capture.sock").path
    }

    var bootstrap: CaptureBootstrap {
        CaptureBootstrap(
            protocolVersion: captureProtocolVersion,
            socketPath: socketPath,
            token: token,
            idleTimeoutMs: 1_000
        )
    }

    func waitUntilReady() async throws {
        for _ in 0..<100 {
            if FileManager.default.fileExists(atPath: socketPath) { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        throw FixtureError.socketNotReady
    }

    func socketMode() throws -> UInt16 {
        let attributes = try FileManager.default.attributesOfItem(atPath: socketPath)
        return UInt16(truncating: attributes[.posixPermissions] as? NSNumber ?? 0)
    }

    func request(_ request: CaptureRequest) throws -> (header: CaptureResponseHeader, png: Data) {
        let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
        guard descriptor >= 0 else { throw FixtureError.socketFailure }
        defer { close(descriptor) }

        var address = try unixAddress(path: socketPath)
        let connected = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { addressPointer in
                Darwin.connect(descriptor, addressPointer, unixAddressLength(path: socketPath))
            }
        }
        guard connected == 0 else { throw FixtureError.socketFailure }

        var requestData = try JSONEncoder().encode(request)
        requestData.append(0x0A)
        try writeAll(descriptor: descriptor, data: requestData)
        let headerData = try readLine(descriptor: descriptor)
        let header = try JSONDecoder().decode(CaptureResponseHeader.self, from: headerData)
        let png = try readExactly(descriptor: descriptor, count: header.byteLength ?? 0)
        return (header, png)
    }

    func cleanup() {
        try? FileManager.default.removeItem(at: directory)
    }
}

private enum FixtureError: Error {
    case socketFailure
    case socketNotReady
    case unexpectedEnd
}

private func unixAddress(path: String) throws -> sockaddr_un {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8) + [0]
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
        throw FixtureError.socketFailure
    }
    withUnsafeMutableBytes(of: &address.sun_path) { destination in
        destination.copyBytes(from: bytes)
    }
    address.sun_len = UInt8(unixAddressLength(path: path))
    return address
}

private func unixAddressLength(path: String) -> socklen_t {
    socklen_t(MemoryLayout<sa_family_t>.size + path.utf8.count + 1)
}

private func writeAll(descriptor: Int32, data: Data) throws {
    try data.withUnsafeBytes { rawBuffer in
        guard let base = rawBuffer.baseAddress else { return }
        var written = 0
        while written < rawBuffer.count {
            let count = Darwin.write(descriptor, base.advanced(by: written), rawBuffer.count - written)
            guard count > 0 else { throw FixtureError.socketFailure }
            written += count
        }
    }
}

private func readLine(descriptor: Int32) throws -> Data {
    var result = Data()
    var byte: UInt8 = 0
    while result.count <= maximumRequestBytes {
        let count = Darwin.read(descriptor, &byte, 1)
        guard count == 1 else { throw FixtureError.unexpectedEnd }
        if byte == 0x0A { return result }
        result.append(byte)
    }
    throw FixtureError.socketFailure
}

private func readExactly(descriptor: Int32, count: Int) throws -> Data {
    var result = Data(count: count)
    var offset = 0
    while offset < count {
        let readCount = result.withUnsafeMutableBytes { buffer in
            Darwin.read(descriptor, buffer.baseAddress?.advanced(by: offset), count - offset)
        }
        guard readCount > 0 else { throw FixtureError.unexpectedEnd }
        offset += readCount
    }
    return result
}
