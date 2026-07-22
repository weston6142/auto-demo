import AppKit
import AutoDemoCaptureCore
import Foundation

struct AppKitCaptureApplicationLauncher: CaptureApplicationLaunching {
    func launch(_ request: CaptureApplicationLaunch) async throws -> any CaptureRunningApplication {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.arguments = request.arguments
        configuration.activates = request.activates
        configuration.createsNewApplicationInstance = request.createsNewInstance
        configuration.allowsRunningApplicationSubstitution = request.allowsSubstitution
        configuration.addsToRecentItems = false
        let application = try await NSWorkspace.shared.openApplication(
            at: request.applicationURL,
            configuration: configuration
        )
        return AppKitRunningApplication(application: application)
    }
}

private final class AppKitRunningApplication: @unchecked Sendable, CaptureRunningApplication {
    private let application: NSRunningApplication

    init(application: NSRunningApplication) {
        self.application = application
    }

    func isTerminated() async -> Bool { application.isTerminated }
    func terminate() async -> Bool { application.terminate() }
    func forceTerminate() async -> Bool { application.forceTerminate() }
}
