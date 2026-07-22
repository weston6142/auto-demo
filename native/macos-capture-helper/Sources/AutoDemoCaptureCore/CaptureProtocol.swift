import CoreGraphics
import Foundation

public let captureProtocolVersion = 1
public let maximumCaptureDimension = 8_192
public let maximumCaptureBytes = 32 * 1_024 * 1_024
public let maximumRequestBytes = 8 * 1_024
public let minimumIdleTimeoutMs = 1_000
public let maximumIdleTimeoutMs = 30_000

private let maximumScreenCoordinate = 1_000_000
private let maximumUnixSocketPathBytes = 103

public struct CaptureBootstrap: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let socketPath: String
    public let token: String
    public let idleTimeoutMs: Int

    public init(
        protocolVersion: Int,
        socketPath: String,
        token: String,
        idleTimeoutMs: Int
    ) {
        self.protocolVersion = protocolVersion
        self.socketPath = socketPath
        self.token = token
        self.idleTimeoutMs = idleTimeoutMs
    }

    public func validated() throws -> Self {
        guard protocolVersion == captureProtocolVersion,
              socketPath.hasPrefix("/"),
              !socketPath.contains("\0"),
              socketPath.utf8.count <= maximumUnixSocketPathBytes,
              isValidToken(token),
              (minimumIdleTimeoutMs...maximumIdleTimeoutMs).contains(idleTimeoutMs)
        else {
            throw CaptureProtocolError.invalidRequest
        }
        return self
    }
}

public struct CaptureRequest: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let token: String
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int

    public init(
        protocolVersion: Int,
        token: String,
        x: Int,
        y: Int,
        width: Int,
        height: Int
    ) {
        self.protocolVersion = protocolVersion
        self.token = token
        self.x = x
        self.y = y
        self.width = width
        self.height = height
    }

    public var region: CGRect {
        CGRect(x: x, y: y, width: width, height: height)
    }

    public func validated(expectedToken: String) throws -> Self {
        guard isValidToken(token),
              isValidToken(expectedToken),
              constantTimeEqual(token, expectedToken)
        else {
            throw CaptureProtocolError.authenticationFailed
        }
        guard protocolVersion == captureProtocolVersion else {
            throw CaptureProtocolError.invalidRequest
        }
        guard isValidRegion() else {
            throw CaptureProtocolError.invalidRegion
        }
        return self
    }

    private func isValidRegion() -> Bool {
        guard width > 0,
              height > 0,
              width <= maximumCaptureDimension,
              height <= maximumCaptureDimension,
              absCoordinateIsBounded(x),
              absCoordinateIsBounded(y)
        else {
            return false
        }
        let (_, pixelOverflow) = width.multipliedReportingOverflow(by: height)
        let (_, xOverflow) = x.addingReportingOverflow(width)
        let (_, yOverflow) = y.addingReportingOverflow(height)
        return !pixelOverflow && !xOverflow && !yOverflow
    }
}

public struct CaptureResponseHeader: Codable, Equatable, Sendable {
    public let ok: Bool
    public let code: String?
    public let message: String?
    public let byteLength: Int?
    public let width: Int?
    public let height: Int?

    public init(
        ok: Bool,
        code: String?,
        message: String?,
        byteLength: Int?,
        width: Int?,
        height: Int?
    ) {
        self.ok = ok
        self.code = code
        self.message = message
        self.byteLength = byteLength
        self.width = width
        self.height = height
    }

    public static func success(byteLength: Int, width: Int, height: Int) throws -> Self {
        guard byteLength > 0,
              byteLength <= maximumCaptureBytes,
              width > 0,
              width <= maximumCaptureDimension,
              height > 0,
              height <= maximumCaptureDimension
        else {
            throw CaptureProtocolError.responseTooLarge
        }
        return Self(
            ok: true,
            code: nil,
            message: nil,
            byteLength: byteLength,
            width: width,
            height: height
        )
    }

    public static func failure(_ error: CaptureProtocolError) -> Self {
        Self(
            ok: false,
            code: error.rawValue,
            message: error.localizedDescription,
            byteLength: nil,
            width: nil,
            height: nil
        )
    }
}

public enum CaptureProtocolError: String, Error, LocalizedError, Sendable {
    case authenticationFailed = "capture_authentication_failed"
    case invalidRequest = "capture_request_invalid"
    case invalidRegion = "capture_region_invalid"
    case captureFailed = "native_window_capture_unavailable"
    case responseTooLarge = "capture_response_too_large"

    public var errorDescription: String? {
        switch self {
        case .authenticationFailed:
            "Capture helper authentication failed."
        case .invalidRequest:
            "Capture request is invalid."
        case .invalidRegion:
            "Capture region is invalid."
        case .captureFailed:
            "Native browser UI capture is unavailable."
        case .responseTooLarge:
            "Capture response exceeds the allowed size."
        }
    }
}

private func isValidToken(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { byte in
        (48...57).contains(byte) || (97...102).contains(byte)
    }
}

private func constantTimeEqual(_ left: String, _ right: String) -> Bool {
    let leftBytes = Array(left.utf8)
    let rightBytes = Array(right.utf8)
    let count = max(leftBytes.count, rightBytes.count)
    var difference = UInt8(truncatingIfNeeded: leftBytes.count ^ rightBytes.count)
    for index in 0..<count {
        let leftByte = index < leftBytes.count ? leftBytes[index] : 0
        let rightByte = index < rightBytes.count ? rightBytes[index] : 0
        difference |= leftByte ^ rightByte
    }
    return difference == 0
}

private func absCoordinateIsBounded(_ value: Int) -> Bool {
    value >= -maximumScreenCoordinate && value <= maximumScreenCoordinate
}
