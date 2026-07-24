import Foundation
import XCTest
@testable import AutoDemoCaptureCore

final class CaptureApplicationSupervisorTests: XCTestCase {
    func testLaunchesFreshNonActivatingEnclosingApplication() async throws {
        let application = FakeRunningApplication(terminated: true)
        let launcher = FakeApplicationLauncher(application: application)
        let supervisor = CaptureApplicationSupervisor(
            launcher: launcher,
            supervisorExecutableURL: URL(
                fileURLWithPath: "/Applications/Auto Demo Capture.app/Contents/MacOS/AutoDemoCaptureSupervisor"
            ),
            terminationGrace: .milliseconds(20),
            pollInterval: .milliseconds(1)
        )
        let request = ValidatedCaptureLaunchRequest(
            requestPath: "/private/request.json",
            request: CaptureLaunchRequest(
                protocolVersion: captureProtocolVersion,
                mode: .version,
                responsePath: "/private/response.json",
                bootstrapPath: nil
            )
        )

        try await supervisor.run(request: request)

        let launches = await launcher.recordedLaunches()
        XCTAssertEqual(launches, [
            CaptureApplicationLaunch(
                applicationURL: URL(
                    fileURLWithPath: "/Applications/Auto Demo Capture.app",
                    isDirectory: true
                ),
                arguments: ["--supervised-request", "/private/request.json"],
                createsNewInstance: true,
                activates: false,
                allowsSubstitution: false
            ),
        ])
    }

    func testGracefullyTerminatesExactApplicationOnShutdown() async throws {
        let application = FakeRunningApplication(terminatesGracefully: true)
        let launcher = FakeApplicationLauncher(application: application)
        let supervisor = makeSupervisor(launcher: launcher)
        let request = serviceRequest()
        let running = Task { try await supervisor.run(request: request) }
        await waitUntilLaunched(launcher)

        await supervisor.shutdown()
        try await running.value

        let actions = await application.recordedActions()
        XCTAssertEqual(actions, [.terminate])
    }

    func testForceTerminatesOnlyAfterGracePeriod() async throws {
        let application = FakeRunningApplication(terminatesGracefully: false)
        let launcher = FakeApplicationLauncher(application: application)
        let supervisor = makeSupervisor(launcher: launcher)
        let request = serviceRequest()
        let running = Task { try await supervisor.run(request: request) }
        await waitUntilLaunched(launcher)

        await supervisor.shutdown()
        try await running.value

        let actions = await application.recordedActions()
        XCTAssertEqual(actions, [.terminate, .forceTerminate])
    }

    func testFailsBoundedlyWhenForceTerminationDoesNotStopApplication() async throws {
        let application = FakeRunningApplication(
            terminatesGracefully: false,
            forceTerminates: false
        )
        let launcher = FakeApplicationLauncher(application: application)
        let supervisor = makeSupervisor(launcher: launcher)
        let request = serviceRequest()
        let running = Task { try await supervisor.run(request: request) }
        await waitUntilLaunched(launcher)

        await supervisor.shutdown()

        do {
            try await running.value
            XCTFail("expected termination confirmation failure")
        } catch {
            XCTAssertEqual(
                error as? CaptureApplicationSupervisorError,
                .terminationFailed
            )
        }
        let actions = await application.recordedActions()
        XCTAssertEqual(actions, [.terminate, .forceTerminate])
    }

    func testDerivesOnlyAnEnclosingApplicationBundle() throws {
        XCTAssertEqual(
            try enclosingCaptureApplicationURL(
                supervisorExecutableURL: URL(
                    fileURLWithPath: "/Users/test/Applications/Auto Demo Capture.app/Contents/MacOS/AutoDemoCaptureSupervisor"
                )
            ).path,
            "/Users/test/Applications/Auto Demo Capture.app"
        )
        XCTAssertThrowsError(
            try enclosingCaptureApplicationURL(
                supervisorExecutableURL: URL(fileURLWithPath: "/usr/local/bin/AutoDemoCaptureSupervisor")
            )
        )
    }

    private func makeSupervisor(launcher: FakeApplicationLauncher) -> CaptureApplicationSupervisor {
        CaptureApplicationSupervisor(
            launcher: launcher,
            supervisorExecutableURL: URL(
                fileURLWithPath: "/Applications/Auto Demo Capture.app/Contents/MacOS/AutoDemoCaptureSupervisor"
            ),
            terminationGrace: .milliseconds(10),
            forceTerminationGrace: .milliseconds(10),
            pollInterval: .milliseconds(1)
        )
    }

    private func serviceRequest() -> ValidatedCaptureLaunchRequest {
        ValidatedCaptureLaunchRequest(
            requestPath: "/private/request.json",
            request: CaptureLaunchRequest(
                protocolVersion: captureProtocolVersion,
                mode: .service,
                responsePath: nil,
                bootstrapPath: "/private/bootstrap.json"
            )
        )
    }

    private func waitUntilLaunched(_ launcher: FakeApplicationLauncher) async {
        for _ in 0..<100 {
            if !(await launcher.recordedLaunches()).isEmpty { return }
            try? await Task.sleep(for: .milliseconds(1))
        }
    }
}

private enum ApplicationAction: Equatable {
    case terminate
    case forceTerminate
}

private actor FakeRunningApplication: CaptureRunningApplication {
    private var terminated: Bool
    private let terminatesGracefully: Bool
    private let forceTerminates: Bool
    private var actions: [ApplicationAction] = []

    init(
        terminated: Bool = false,
        terminatesGracefully: Bool = true,
        forceTerminates: Bool = true
    ) {
        self.terminated = terminated
        self.terminatesGracefully = terminatesGracefully
        self.forceTerminates = forceTerminates
    }

    func isTerminated() -> Bool { terminated }

    func terminate() -> Bool {
        actions.append(.terminate)
        if terminatesGracefully { terminated = true }
        return true
    }

    func forceTerminate() -> Bool {
        actions.append(.forceTerminate)
        if forceTerminates { terminated = true }
        return true
    }

    func recordedActions() -> [ApplicationAction] { actions }
}

private actor FakeApplicationLauncher: CaptureApplicationLaunching {
    private let application: FakeRunningApplication
    private var launches: [CaptureApplicationLaunch] = []

    init(application: FakeRunningApplication) {
        self.application = application
    }

    func launch(_ request: CaptureApplicationLaunch) -> any CaptureRunningApplication {
        launches.append(request)
        return application
    }

    func recordedLaunches() -> [CaptureApplicationLaunch] { launches }
}
