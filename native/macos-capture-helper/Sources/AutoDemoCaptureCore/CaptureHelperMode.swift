import Foundation

public let captureHelperBundleIdentifier = "com.autodemo.capture-helper"

public protocol CapturePermissionChecking: Sendable {
    func preflight() async -> Bool
    func request() async -> Bool
}

public enum CaptureHelperModeError: Error, Equatable, Sendable {
    case invalidRequest
    case permissionRequired
}

public func executeCaptureHelperRequest(
    _ validatedRequest: ValidatedCaptureLaunchRequest,
    permission: any CapturePermissionChecking,
    serve: @Sendable (String) async throws -> Void
) async throws {
    let request = validatedRequest.request
    guard request.protocolVersion == captureProtocolVersion else {
        throw CaptureHelperModeError.invalidRequest
    }
    switch request.mode {
    case .version:
        let responsePath = try probeResponsePath(request)
        try writePrivateCaptureLaunchResult(
            .success(
                code: "capture_helper_version",
                values: [
                    "protocolVersion": .integer(captureProtocolVersion),
                    "bundleIdentifier": .string(captureHelperBundleIdentifier),
                ]
            ),
            path: responsePath
        )
    case .permissionPreflight:
        let responsePath = try probeResponsePath(request)
        let granted = await permission.preflight()
        try writePrivateCaptureLaunchResult(permissionResult(granted: granted), path: responsePath)
    case .permissionRequest:
        let responsePath = try probeResponsePath(request)
        let granted = await permission.request()
        try writePrivateCaptureLaunchResult(permissionResult(granted: granted), path: responsePath)
    case .service:
        guard request.responsePath == nil,
              let bootstrapPath = request.bootstrapPath,
              await permission.preflight()
        else {
            throw CaptureHelperModeError.permissionRequired
        }
        try await serve(bootstrapPath)
    }
}

private func probeResponsePath(_ request: CaptureLaunchRequest) throws -> String {
    guard request.bootstrapPath == nil,
          let responsePath = request.responsePath
    else {
        throw CaptureHelperModeError.invalidRequest
    }
    return responsePath
}

private func permissionResult(granted: Bool) -> CaptureLaunchResult {
    granted
        ? .success(code: "capture_helper_permission_granted")
        : .failure(
            code: "capture_helper_permission_required",
            message: "Auto Demo Capture needs Screen Recording permission."
        )
}
