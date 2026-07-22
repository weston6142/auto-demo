import Foundation

public struct CaptureApplicationLaunch: Equatable, Sendable {
    public let applicationURL: URL
    public let arguments: [String]
    public let createsNewInstance: Bool
    public let activates: Bool
    public let allowsSubstitution: Bool

    public init(
        applicationURL: URL,
        arguments: [String],
        createsNewInstance: Bool,
        activates: Bool,
        allowsSubstitution: Bool
    ) {
        self.applicationURL = applicationURL
        self.arguments = arguments
        self.createsNewInstance = createsNewInstance
        self.activates = activates
        self.allowsSubstitution = allowsSubstitution
    }
}

public protocol CaptureRunningApplication: Sendable {
    func isTerminated() async -> Bool
    func terminate() async -> Bool
    func forceTerminate() async -> Bool
}

public protocol CaptureApplicationLaunching: Sendable {
    func launch(_ request: CaptureApplicationLaunch) async throws -> any CaptureRunningApplication
}

public enum CaptureApplicationSupervisorError: Error, Equatable, Sendable {
    case invalidApplicationBundle
    case alreadyRunning
}

public actor CaptureApplicationSupervisor {
    private let launcher: any CaptureApplicationLaunching
    private let supervisorExecutableURL: URL
    private let terminationGrace: Duration
    private let pollInterval: Duration
    private var application: (any CaptureRunningApplication)?
    private var shutdownRequested = false

    public init(
        launcher: any CaptureApplicationLaunching,
        supervisorExecutableURL: URL,
        terminationGrace: Duration = .seconds(2),
        pollInterval: Duration = .milliseconds(50)
    ) {
        self.launcher = launcher
        self.supervisorExecutableURL = supervisorExecutableURL
        self.terminationGrace = terminationGrace
        self.pollInterval = pollInterval
    }

    public func run(request: ValidatedCaptureLaunchRequest) async throws {
        guard application == nil else {
            throw CaptureApplicationSupervisorError.alreadyRunning
        }
        let applicationURL = try enclosingCaptureApplicationURL(
            supervisorExecutableURL: supervisorExecutableURL
        )
        let launch = CaptureApplicationLaunch(
            applicationURL: applicationURL,
            arguments: ["--supervised-request", request.requestPath],
            createsNewInstance: true,
            activates: false,
            allowsSubstitution: false
        )
        let launchedApplication = try await launcher.launch(launch)
        application = launchedApplication
        if shutdownRequested {
            await terminate(launchedApplication)
        }
        while !(await launchedApplication.isTerminated()) {
            try await Task.sleep(for: pollInterval)
        }
        application = nil
    }

    public func shutdown() async {
        guard !shutdownRequested else { return }
        shutdownRequested = true
        guard let application else { return }
        await terminate(application)
    }

    private func terminate(_ application: any CaptureRunningApplication) async {
        guard !(await application.isTerminated()) else { return }
        _ = await application.terminate()
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: terminationGrace)
        while clock.now < deadline {
            if await application.isTerminated() { return }
            try? await Task.sleep(for: pollInterval)
        }
        if !(await application.isTerminated()) {
            _ = await application.forceTerminate()
        }
    }
}

public func enclosingCaptureApplicationURL(supervisorExecutableURL: URL) throws -> URL {
    let executableURL = supervisorExecutableURL.standardizedFileURL
    let macOSDirectory = executableURL.deletingLastPathComponent()
    let contentsDirectory = macOSDirectory.deletingLastPathComponent()
    let applicationURL = contentsDirectory.deletingLastPathComponent()
    guard macOSDirectory.lastPathComponent == "MacOS",
          contentsDirectory.lastPathComponent == "Contents",
          applicationURL.pathExtension == "app",
          !applicationURL.path.contains("\0")
    else {
        throw CaptureApplicationSupervisorError.invalidApplicationBundle
    }
    return applicationURL
}
