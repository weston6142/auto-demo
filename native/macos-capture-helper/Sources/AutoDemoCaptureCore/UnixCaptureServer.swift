import Darwin
import Foundation

public final class UnixCaptureServer<Provider: CaptureProvider>: @unchecked Sendable {
    private let bootstrap: CaptureBootstrap
    private let provider: Provider
    private let maximumRequests: Int?
    private let pollTimeoutOverrideMs: Int?

    public init(
        bootstrap: CaptureBootstrap,
        provider: Provider,
        maximumRequests: Int? = nil,
        pollTimeoutOverrideMs: Int? = nil
    ) {
        self.bootstrap = bootstrap
        self.provider = provider
        self.maximumRequests = maximumRequests
        self.pollTimeoutOverrideMs = pollTimeoutOverrideMs
    }

    public func run() async throws {
        let validated = try bootstrap.validated()
        let listener = try createListener(path: validated.socketPath)
        defer {
            close(listener)
            removeOwnedSocket(validated.socketPath)
        }

        var served = 0
        while maximumRequests.map({ served < $0 }) ?? true {
            var descriptor = pollfd(fd: listener, events: Int16(POLLIN), revents: 0)
            let timeout = Int32(pollTimeoutOverrideMs ?? validated.idleTimeoutMs)
            let pollResult = Darwin.poll(&descriptor, 1, timeout)
            if pollResult == 0 { return }
            guard pollResult > 0, descriptor.revents & Int16(POLLIN) != 0 else {
                if errno == EINTR { continue }
                throw CaptureServerError.socketFailure
            }
            let client = Darwin.accept(listener, nil, nil)
            guard client >= 0 else {
                if errno == EINTR { continue }
                throw CaptureServerError.socketFailure
            }
            served += 1
            await handle(client: client, expectedToken: validated.token)
            close(client)
        }
    }

    private func handle(client: Int32, expectedToken: String) async {
        do {
            try configureTimeout(client)
            guard try isCurrentUser(client) else {
                try writeResponse(.failure(.authenticationFailed), png: nil, to: client)
                return
            }
            let requestData = try readLine(from: client)
            let request: CaptureRequest
            do {
                request = try JSONDecoder().decode(CaptureRequest.self, from: requestData)
            } catch {
                try writeResponse(.failure(.invalidRequest), png: nil, to: client)
                return
            }
            do {
                _ = try request.validated(expectedToken: expectedToken)
            } catch let error as CaptureProtocolError {
                try writeResponse(.failure(error), png: nil, to: client)
                return
            }
            do {
                let png = try await provider.capture(
                    region: request.region,
                    outputSize: CGSize(width: request.width, height: request.height)
                )
                let header = try CaptureResponseHeader.success(
                    byteLength: png.count,
                    width: request.width,
                    height: request.height
                )
                try writeResponse(header, png: png, to: client)
            } catch let error as CaptureProtocolError {
                try writeResponse(.failure(error), png: nil, to: client)
            } catch {
                try writeResponse(.failure(.captureFailed), png: nil, to: client)
            }
        } catch {
            try? writeResponse(.failure(.invalidRequest), png: nil, to: client)
        }
    }
}

private enum CaptureServerError: Error {
    case socketFailure
    case invalidSocketPath
    case unexpectedEnd
    case requestTooLarge
}

private func createListener(path: String) throws -> Int32 {
    guard path.hasPrefix("/"), path.utf8.count <= 103 else {
        throw CaptureServerError.invalidSocketPath
    }
    var existing = stat()
    if lstat(path, &existing) == 0 || errno != ENOENT {
        throw CaptureServerError.socketFailure
    }
    let descriptor = socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else { throw CaptureServerError.socketFailure }
    do {
        var address = try unixAddress(path: path)
        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { addressPointer in
                Darwin.bind(descriptor, addressPointer, unixAddressLength(path: path))
            }
        }
        guard bindResult == 0,
              chmod(path, S_IRUSR | S_IWUSR) == 0,
              listen(descriptor, 1) == 0
        else {
            throw CaptureServerError.socketFailure
        }
        return descriptor
    } catch {
        close(descriptor)
        removeOwnedSocket(path)
        throw error
    }
}

private func removeOwnedSocket(_ path: String) {
    var metadata = stat()
    guard lstat(path, &metadata) == 0,
          metadata.st_uid == getuid(),
          metadata.st_mode & S_IFMT == S_IFSOCK
    else {
        return
    }
    unlink(path)
}

private func unixAddress(path: String) throws -> sockaddr_un {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let bytes = Array(path.utf8) + [0]
    guard bytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
        throw CaptureServerError.invalidSocketPath
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

private func configureTimeout(_ descriptor: Int32) throws {
    var timeout = timeval(tv_sec: 5, tv_usec: 0)
    let size = socklen_t(MemoryLayout<timeval>.size)
    guard setsockopt(descriptor, SOL_SOCKET, SO_RCVTIMEO, &timeout, size) == 0,
          setsockopt(descriptor, SOL_SOCKET, SO_SNDTIMEO, &timeout, size) == 0
    else {
        throw CaptureServerError.socketFailure
    }
}

private func isCurrentUser(_ descriptor: Int32) throws -> Bool {
    var effectiveUser = uid_t()
    var effectiveGroup = gid_t()
    guard getpeereid(descriptor, &effectiveUser, &effectiveGroup) == 0 else {
        throw CaptureServerError.socketFailure
    }
    return effectiveUser == getuid()
}

private func readLine(from descriptor: Int32) throws -> Data {
    var result = Data()
    var byte: UInt8 = 0
    while result.count <= maximumRequestBytes {
        let count = Darwin.read(descriptor, &byte, 1)
        if count == 0 { throw CaptureServerError.unexpectedEnd }
        if count < 0 {
            if errno == EINTR { continue }
            throw CaptureServerError.socketFailure
        }
        if byte == 0x0A { return result }
        result.append(byte)
    }
    throw CaptureServerError.requestTooLarge
}

private func writeResponse(
    _ header: CaptureResponseHeader,
    png: Data?,
    to descriptor: Int32
) throws {
    var headerData = try JSONEncoder().encode(header)
    headerData.append(0x0A)
    try writeAll(headerData, to: descriptor)
    if let png { try writeAll(png, to: descriptor) }
}

private func writeAll(_ data: Data, to descriptor: Int32) throws {
    try data.withUnsafeBytes { buffer in
        guard let baseAddress = buffer.baseAddress else { return }
        var offset = 0
        while offset < buffer.count {
            let count = Darwin.write(
                descriptor,
                baseAddress.advanced(by: offset),
                buffer.count - offset
            )
            if count < 0, errno == EINTR { continue }
            guard count > 0 else { throw CaptureServerError.socketFailure }
            offset += count
        }
    }
}
