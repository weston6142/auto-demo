import AutoDemoCaptureCore
import Darwin
import Dispatch
import Foundation

struct AutoDemoCaptureSupervisorMain {
    static func run() async {
        let arguments = Array(CommandLine.arguments.dropFirst())
        guard arguments.count == 2,
              arguments[0] == "--launch-request",
              let executableURL = Bundle.main.executableURL
        else {
            failUnavailable()
        }
        do {
            let request = try loadPrivateCaptureLaunchRequest(path: arguments[1])
            let supervisor = CaptureApplicationSupervisor(
                launcher: AppKitCaptureApplicationLauncher(),
                supervisorExecutableURL: executableURL
            )
            signal(SIGTERM, SIG_IGN)
            signal(SIGINT, SIG_IGN)
            let termSource = terminationSource(signal: SIGTERM, supervisor: supervisor)
            let interruptSource = terminationSource(signal: SIGINT, supervisor: supervisor)
            termSource.resume()
            interruptSource.resume()
            try await supervisor.run(request: request)
            termSource.cancel()
            interruptSource.cancel()
        } catch {
            failUnavailable()
        }
    }

    private static func terminationSource(
        signal: Int32,
        supervisor: CaptureApplicationSupervisor
    ) -> DispatchSourceSignal {
        let source = DispatchSource.makeSignalSource(signal: signal, queue: .global())
        source.setEventHandler {
            Task { await supervisor.shutdown() }
        }
        return source
    }

    private static func failUnavailable() -> Never {
        let output = "{\"code\":\"capture_helper_unavailable\",\"ok\":false}\n"
        try? FileHandle.standardError.write(contentsOf: Data(output.utf8))
        Darwin.exit(EXIT_FAILURE)
    }
}

await AutoDemoCaptureSupervisorMain.run()
