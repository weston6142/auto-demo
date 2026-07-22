import Darwin
import Foundation

private let maximumCaptureLaunchBytes: off_t = 16 * 1_024

public enum CaptureLaunchMode: String, Codable, Sendable {
    case version
    case permissionPreflight = "permission-preflight"
    case permissionRequest = "permission-request"
    case service
}

public enum CaptureLaunchValue: Codable, Equatable, Sendable {
    case integer(Int)
    case string(String)

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let value = try? container.decode(Int.self) {
            self = .integer(value)
        } else {
            self = .string(try container.decode(String.self))
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case let .integer(value):
            try container.encode(value)
        case let .string(value):
            try container.encode(value)
        }
    }
}

public struct CaptureLaunchRequest: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let mode: CaptureLaunchMode
    public let responsePath: String?
    public let bootstrapPath: String?

    public init(
        protocolVersion: Int,
        mode: CaptureLaunchMode,
        responsePath: String?,
        bootstrapPath: String?
    ) {
        self.protocolVersion = protocolVersion
        self.mode = mode
        self.responsePath = responsePath
        self.bootstrapPath = bootstrapPath
    }
}

public struct ValidatedCaptureLaunchRequest: Equatable, Sendable {
    public let requestPath: String
    public let request: CaptureLaunchRequest

    public init(requestPath: String, request: CaptureLaunchRequest) {
        self.requestPath = requestPath
        self.request = request
    }
}

public struct CaptureLaunchResult: Codable, Equatable, Sendable {
    public let ok: Bool
    public let code: String
    public let message: String?
    public let values: [String: CaptureLaunchValue]

    public init(
        ok: Bool,
        code: String,
        message: String?,
        values: [String: CaptureLaunchValue]
    ) {
        self.ok = ok
        self.code = code
        self.message = message
        self.values = values
    }

    public static func success(
        code: String,
        values: [String: CaptureLaunchValue] = [:]
    ) -> Self {
        Self(ok: true, code: code, message: nil, values: values)
    }

    public static func failure(code: String, message: String) -> Self {
        Self(ok: false, code: code, message: message, values: [:])
    }
}

public enum CaptureLaunchProtocolError: Error, Equatable, Sendable {
    case invalidRequest
    case invalidResult
    case ioFailure
}

public func loadPrivateCaptureLaunchRequest(
    path: String
) throws -> ValidatedCaptureLaunchRequest {
    try validateAbsolutePath(path)
    try validatePrivateDirectory(URL(fileURLWithPath: path).deletingLastPathComponent().path)
    let data = try readPrivateRegularFile(path: path)
    let request: CaptureLaunchRequest
    do {
        request = try JSONDecoder().decode(CaptureLaunchRequest.self, from: data)
    } catch {
        throw CaptureLaunchProtocolError.invalidRequest
    }
    guard request.protocolVersion == captureProtocolVersion else {
        throw CaptureLaunchProtocolError.invalidRequest
    }
    switch request.mode {
    case .version, .permissionPreflight, .permissionRequest:
        guard let responsePath = request.responsePath,
              request.bootstrapPath == nil
        else {
            throw CaptureLaunchProtocolError.invalidRequest
        }
        try validateAbsolutePath(responsePath)
        let requestDirectory = URL(fileURLWithPath: path).deletingLastPathComponent().standardizedFileURL.path
        let responseDirectory = URL(fileURLWithPath: responsePath).deletingLastPathComponent().standardizedFileURL.path
        guard requestDirectory == responseDirectory,
              URL(fileURLWithPath: responsePath).standardizedFileURL.path == responsePath,
              !pathExistsWithoutFollowingSymlinks(responsePath)
        else {
            throw CaptureLaunchProtocolError.invalidRequest
        }
    case .service:
        guard request.responsePath == nil,
              let bootstrapPath = request.bootstrapPath
        else {
            throw CaptureLaunchProtocolError.invalidRequest
        }
        try validateAbsolutePath(bootstrapPath)
        _ = try readPrivateRegularFile(path: bootstrapPath)
    }
    return ValidatedCaptureLaunchRequest(requestPath: path, request: request)
}

public func loadPrivateCaptureLaunchResult(path: String) throws -> CaptureLaunchResult {
    try validateAbsolutePath(path)
    let data = try readPrivateRegularFile(path: path)
    do {
        let result = try JSONDecoder().decode(CaptureLaunchResult.self, from: data)
        try validateResult(result)
        return result
    } catch let error as CaptureLaunchProtocolError {
        throw error
    } catch {
        throw CaptureLaunchProtocolError.invalidResult
    }
}

public func writePrivateCaptureLaunchResult(
    _ result: CaptureLaunchResult,
    path: String
) throws {
    try validateAbsolutePath(path)
    try validatePrivateDirectory(URL(fileURLWithPath: path).deletingLastPathComponent().path)
    try validateResult(result)
    var data: Data
    do {
        data = try JSONEncoder().encode(result)
    } catch {
        throw CaptureLaunchProtocolError.invalidResult
    }
    data.append(0x0A)
    guard data.count <= maximumCaptureLaunchBytes else {
        throw CaptureLaunchProtocolError.invalidResult
    }
    let descriptor = open(path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else {
        throw CaptureLaunchProtocolError.ioFailure
    }
    var completed = false
    defer {
        close(descriptor)
        if !completed { unlink(path) }
    }
    var offset = 0
    try data.withUnsafeBytes { bytes in
        guard let baseAddress = bytes.baseAddress else { return }
        while offset < data.count {
            let count = Darwin.write(
                descriptor,
                baseAddress.advanced(by: offset),
                data.count - offset
            )
            guard count > 0 else {
                throw CaptureLaunchProtocolError.ioFailure
            }
            offset += count
        }
    }
    guard fsync(descriptor) == 0 else {
        throw CaptureLaunchProtocolError.ioFailure
    }
    completed = true
}

private func validateResult(_ result: CaptureLaunchResult) throws {
    guard !result.code.isEmpty,
          result.code.utf8.count <= 128,
          result.message?.utf8.count ?? 0 <= 512,
          result.values.count <= 16,
          result.values.allSatisfy({ key, value in
              guard !key.isEmpty, key.utf8.count <= 64 else { return false }
              if case let .string(string) = value { return string.utf8.count <= 512 }
              return true
          })
    else {
        throw CaptureLaunchProtocolError.invalidResult
    }
}

private func validateAbsolutePath(_ path: String) throws {
    guard path.hasPrefix("/"),
          !path.contains("\0"),
          path.utf8.count <= Int(PATH_MAX)
    else {
        throw CaptureLaunchProtocolError.invalidRequest
    }
}

private func validatePrivateDirectory(_ path: String) throws {
    var metadata = stat()
    guard lstat(path, &metadata) == 0,
          metadata.st_uid == getuid(),
          metadata.st_mode & S_IFMT == S_IFDIR,
          metadata.st_mode & 0o077 == 0
    else {
        throw CaptureLaunchProtocolError.invalidRequest
    }
}

private func readPrivateRegularFile(path: String) throws -> Data {
    let descriptor = open(path, O_RDONLY | O_NOFOLLOW)
    guard descriptor >= 0 else {
        throw CaptureLaunchProtocolError.invalidRequest
    }
    defer { close(descriptor) }
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          metadata.st_uid == getuid(),
          metadata.st_mode & S_IFMT == S_IFREG,
          metadata.st_mode & 0o077 == 0,
          metadata.st_size > 0,
          metadata.st_size <= maximumCaptureLaunchBytes
    else {
        throw CaptureLaunchProtocolError.invalidRequest
    }
    var data = Data(count: Int(metadata.st_size))
    let bytesRead = data.withUnsafeMutableBytes { bytes -> Int in
        guard let baseAddress = bytes.baseAddress else { return 0 }
        return Darwin.read(descriptor, baseAddress, bytes.count)
    }
    guard bytesRead == data.count else {
        throw CaptureLaunchProtocolError.ioFailure
    }
    return data
}

private func pathExistsWithoutFollowingSymlinks(_ path: String) -> Bool {
    var metadata = stat()
    return lstat(path, &metadata) == 0 || errno != ENOENT
}
