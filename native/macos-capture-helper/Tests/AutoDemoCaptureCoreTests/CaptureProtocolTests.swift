import CoreGraphics
import XCTest
@testable import AutoDemoCaptureCore

final class CaptureProtocolTests: XCTestCase {
    private let token = String(repeating: "a", count: 64)

    func testValidatesProtocolV1Request() throws {
        let request = CaptureRequest(
            protocolVersion: 1,
            token: token,
            x: 120,
            y: 80,
            width: 1_280,
            height: 720
        )

        XCTAssertEqual(try request.validated(expectedToken: token), request)
        XCTAssertEqual(request.region, CGRect(x: 120, y: 80, width: 1_280, height: 720))
    }

    func testRejectsUnsupportedProtocol() {
        assertRejected(request(protocolVersion: 2), as: .invalidRequest)
    }

    func testRejectsMalformedOrIncorrectTokens() {
        assertRejected(request(token: "short"), as: .authenticationFailed)
        assertRejected(request(token: String(repeating: "b", count: 64)), as: .authenticationFailed)
        assertRejected(
            request(token: String(repeating: "A", count: 64)),
            expectedToken: String(repeating: "A", count: 64),
            as: .authenticationFailed
        )
    }

    func testRejectsInvalidDimensionsAndCoordinateOverflow() {
        assertRejected(request(width: 0), as: .invalidRegion)
        assertRejected(request(height: -1), as: .invalidRegion)
        assertRejected(request(width: maximumCaptureDimension + 1), as: .invalidRegion)
        assertRejected(request(height: maximumCaptureDimension + 1), as: .invalidRegion)
        assertRejected(request(x: Int.max), as: .invalidRegion)
        assertRejected(request(y: Int.min), as: .invalidRegion)
    }

    func testValidatesBootstrapBounds() throws {
        let bootstrap = CaptureBootstrap(
            protocolVersion: captureProtocolVersion,
            socketPath: "/tmp/auto-demo-capture.sock",
            token: token,
            idleTimeoutMs: 30_000
        )

        XCTAssertEqual(try bootstrap.validated(), bootstrap)
        XCTAssertThrowsError(
            try CaptureBootstrap(
                protocolVersion: 1,
                socketPath: "relative.sock",
                token: token,
                idleTimeoutMs: 30_000
            ).validated()
        )
        XCTAssertThrowsError(
            try CaptureBootstrap(
                protocolVersion: 1,
                socketPath: "/tmp/capture.sock",
                token: token,
                idleTimeoutMs: 999
            ).validated()
        )
    }

    func testCreatesBoundedSuccessAndFailureHeaders() throws {
        XCTAssertEqual(
            try CaptureResponseHeader.success(byteLength: 128, width: 10, height: 10),
            CaptureResponseHeader(
                ok: true,
                code: nil,
                message: nil,
                byteLength: 128,
                width: 10,
                height: 10
            )
        )
        XCTAssertThrowsError(
            try CaptureResponseHeader.success(
                byteLength: maximumCaptureBytes + 1,
                width: 10,
                height: 10
            )
        )
        XCTAssertEqual(
            CaptureResponseHeader.failure(.invalidRegion),
            CaptureResponseHeader(
                ok: false,
                code: "capture_region_invalid",
                message: "Capture region is invalid.",
                byteLength: nil,
                width: nil,
                height: nil
            )
        )
    }

    private func request(
        protocolVersion: Int = captureProtocolVersion,
        token: String? = nil,
        x: Int = 0,
        y: Int = 0,
        width: Int = 1_280,
        height: Int = 720
    ) -> CaptureRequest {
        CaptureRequest(
            protocolVersion: protocolVersion,
            token: token ?? self.token,
            x: x,
            y: y,
            width: width,
            height: height
        )
    }

    private func assertRejected(
        _ request: CaptureRequest,
        expectedToken: String? = nil,
        as expected: CaptureProtocolError,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        XCTAssertThrowsError(
            try request.validated(expectedToken: expectedToken ?? token),
            file: file,
            line: line
        ) { error in
            XCTAssertEqual(error as? CaptureProtocolError, expected, file: file, line: line)
            XCTAssertEqual(error.localizedDescription, expected.localizedDescription, file: file, line: line)
        }
    }
}
