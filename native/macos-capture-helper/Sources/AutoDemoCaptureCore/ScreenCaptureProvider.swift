import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

public protocol CaptureProvider: Sendable {
    func capture(region: CGRect, outputSize: CGSize) async throws -> Data
}

public struct ScreenCaptureKitProvider: CaptureProvider {
    public init() {}

    public func capture(region: CGRect, outputSize: CGSize) async throws -> Data {
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(
                false,
                onScreenWindowsOnly: true
            )
            guard let display = content.displays.first(where: { candidate in
                CGDisplayBounds(candidate.displayID).contains(region)
            }) else {
                throw CaptureProtocolError.captureFailed
            }
            let displayBounds = CGDisplayBounds(display.displayID)
            let localRegion = CGRect(
                x: region.minX - displayBounds.minX,
                y: region.minY - displayBounds.minY,
                width: region.width,
                height: region.height
            )
            let configuration = SCStreamConfiguration()
            configuration.sourceRect = localRegion
            configuration.width = Int(outputSize.width)
            configuration.height = Int(outputSize.height)
            configuration.showsCursor = false
            configuration.capturesAudio = false
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let image = try await SCScreenshotManager.captureImage(
                contentFilter: filter,
                configuration: configuration
            )
            return try pngData(image)
        } catch let error as CaptureProtocolError {
            throw error
        } catch {
            throw CaptureProtocolError.captureFailed
        }
    }
}

private func pngData(_ image: CGImage) throws -> Data {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
        data,
        UTType.png.identifier as CFString,
        1,
        nil
    ) else {
        throw CaptureProtocolError.captureFailed
    }
    CGImageDestinationAddImage(destination, image, nil)
    guard CGImageDestinationFinalize(destination),
          !data.isEmpty,
          data.length <= maximumCaptureBytes
    else {
        throw data.length > maximumCaptureBytes
            ? CaptureProtocolError.responseTooLarge
            : CaptureProtocolError.captureFailed
    }
    return data as Data
}
