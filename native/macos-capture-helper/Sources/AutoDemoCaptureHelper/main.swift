import AutoDemoCaptureCore
import CoreGraphics
import Darwin
import Foundation

private let bundleIdentifier = "com.autodemo.capture-helper"
private let maximumBootstrapBytes: off_t = 16 * 1_024

@main
struct AutoDemoCaptureHelper {
    static func main() async {
        do {
            let arguments = Array(CommandLine.arguments.dropFirst())
            if arguments == ["--version-json"] {
                writeJson([
                    "ok": true,
                    "protocolVersion": captureProtocolVersion,
                    "bundleIdentifier": bundleIdentifier,
                ])
            } else if arguments == ["--preflight-json"] {
                let granted = CGPreflightScreenCaptureAccess()
                writeJson(permissionResult(granted: granted))
                if !granted { Darwin.exit(EXIT_FAILURE) }
            } else if arguments == ["--request-permission-json"] {
                let granted = CGRequestScreenCaptureAccess()
                writeJson(permissionResult(granted: granted))
                if !granted { Darwin.exit(EXIT_FAILURE) }
            } else if arguments.count == 2, arguments[0] == "--serve-bootstrap" {
                guard CGPreflightScreenCaptureAccess() else {
                    throw HelperError.permissionRequired
                }
                let bootstrap = try loadBootstrap(path: arguments[1])
                let server = UnixCaptureServer(
                    bootstrap: bootstrap,
                    provider: ScreenCaptureKitProvider()
                )
                try await server.run()
            } else {
                throw HelperError.invalidArguments
            }
        } catch let error as HelperError {
            writeJson(error.result)
            Darwin.exit(EXIT_FAILURE)
        } catch {
            writeJson(HelperError.helperUnavailable.result)
            Darwin.exit(EXIT_FAILURE)
        }
    }
}

private enum HelperError: Error {
    case invalidArguments
    case invalidBootstrap
    case permissionRequired
    case helperUnavailable

    var result: [String: Any] {
        switch self {
        case .invalidArguments:
            ["ok": false, "code": "invalid_helper_arguments", "message": "Capture helper arguments are invalid."]
        case .invalidBootstrap:
            ["ok": false, "code": "invalid_helper_bootstrap", "message": "Capture helper bootstrap is invalid."]
        case .permissionRequired:
            ["ok": false, "code": "capture_helper_permission_required", "message": "Auto Demo Capture needs Screen Recording permission."]
        case .helperUnavailable:
            ["ok": false, "code": "capture_helper_unavailable", "message": "Auto Demo Capture is unavailable."]
        }
    }
}

private func permissionResult(granted: Bool) -> [String: Any] {
    granted
        ? ["ok": true, "code": "capture_helper_permission_granted"]
        : HelperError.permissionRequired.result
}

private func loadBootstrap(path: String) throws -> CaptureBootstrap {
    guard path.hasPrefix("/"), !path.contains("\0") else {
        throw HelperError.invalidBootstrap
    }
    var metadata = stat()
    guard lstat(path, &metadata) == 0,
          metadata.st_uid == getuid(),
          metadata.st_size > 0,
          metadata.st_size <= maximumBootstrapBytes,
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_mode & 0o077 == 0
    else {
        throw HelperError.invalidBootstrap
    }
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath: path), options: .mappedIfSafe)
        return try JSONDecoder().decode(CaptureBootstrap.self, from: data).validated()
    } catch {
        throw HelperError.invalidBootstrap
    }
}

private func writeJson(_ value: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(value),
          var data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    else {
        return
    }
    data.append(0x0A)
    try? FileHandle.standardOutput.write(contentsOf: data)
}
