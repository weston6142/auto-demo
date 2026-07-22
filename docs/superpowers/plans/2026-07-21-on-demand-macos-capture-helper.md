# On-Demand macOS Capture Helper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace model-host-specific `screencapture` permission with one locally signed, on-demand Auto Demo helper that captures native macOS browser UI for every screenshot-capable CLI agent.

**Architecture:** Add a small Swift 6/macOS 14 app with a stable bundle identifier, ScreenCaptureKit capture provider, authenticated same-user Unix-socket protocol, and bounded lifecycle. Add TypeScript setup, signing, client, and preflight boundaries to the existing CLI and agent packages; ordinary Playwright screenshots remain unchanged, while native-popup frames flow through the helper and are still validated before entering the provider-neutral PNG-plus-JSON protocol.

**Tech Stack:** Swift Package Manager, AppKit, ScreenCaptureKit, CoreGraphics, ImageIO, POSIX Unix sockets, TypeScript, Node.js, Playwright, Vitest, existing Auto Demo CLI/session contracts, Linear CLI.

---

## File Structure

- Create `native/macos-capture-helper/Package.swift` for the macOS 14 Swift package, library, executable, and test targets.
- Create `native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureProtocol.swift` for protocol-v1 Codable messages, bounds, sanitized errors, and constant-time token comparison.
- Create `native/macos-capture-helper/Sources/AutoDemoCaptureCore/UnixCaptureServer.swift` for owner-only socket creation, peer-UID enforcement, framed request/response I/O, timeout, and shutdown behavior.
- Create `native/macos-capture-helper/Sources/AutoDemoCaptureCore/ScreenCaptureProvider.swift` for the injected provider interface and real ScreenCaptureKit exact-region PNG implementation.
- Create `native/macos-capture-helper/Sources/AutoDemoCaptureHelper/main.swift` for version, permission-preflight, permission-request, and session-server modes.
- Create `native/macos-capture-helper/Resources/Info.plist` for `com.autodemo.capture-helper`, agent-only app behavior, and Screen Recording usage copy.
- Create `native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/CaptureProtocolTests.swift` and `UnixCaptureServerTests.swift` for public protocol and server behavior.
- Create `packages/cli/src/macosCaptureHelperSetup.ts` and `.test.ts` for eligible-identity parsing, build/sign/install/preflight orchestration, explicit ad-hoc fallback, and sanitized JSON results.
- Create `packages/agent/src/macOsCaptureHelperClient.ts` and `.test.ts` for private bootstrap creation, helper launch, authenticated requests, bounded PNG reads, and cleanup.
- Modify `packages/agent/src/macOsBrowserWindowCapture.ts` and `.test.ts` to replace direct `/usr/sbin/screencapture` calls with the helper client.
- Modify `packages/agent/src/playwrightCoordinateDiscoveryPage.ts` and tests so closing the adapter closes its optional native capture resource.
- Modify `packages/cli/src/playwrightDiscoverRuntime.ts` and tests to preflight and launch the helper before target-site browser navigation and close it with the session.
- Modify `packages/cli/src/index.ts`, `index.test.ts`, and `package.json` to expose `autodemo setup capture-helper` and include focused tests.
- Modify `.gitignore`, `README.md`, `packages/cli/README.md`, `docs/guides/screenshot-coordinate-discovery.md`, and `docs/linear/auto-demo-project-structure.md` for setup, privacy, capability errors, and WES-273/WES-275 state.

### Task 1: Define The Bounded Swift Capture Protocol

**Files:**

- Create: `native/macos-capture-helper/Package.swift`
- Create: `native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureProtocol.swift`
- Test: `native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/CaptureProtocolTests.swift`

- [ ] **Step 1: Write failing protocol tests**

Create tests that decode one valid request and reject bad versions, tokens, rectangles, dimensions above 8192, pixel overflow, response limits above 32 MiB, and non-constant token mismatches. Assert only fixed public error messages.

```swift
import XCTest
@testable import AutoDemoCaptureCore

final class CaptureProtocolTests: XCTestCase {
    func testValidatesProtocolV1Request() throws {
        let request = CaptureRequest(
            protocolVersion: 1,
            token: String(repeating: "a", count: 64),
            x: 120,
            y: 80,
            width: 1280,
            height: 720
        )
        XCTAssertNoThrow(try request.validated(expectedToken: request.token))
    }

    func testRejectsOversizedRegionWithoutEchoingInput() {
        let request = CaptureRequest(
            protocolVersion: 1,
            token: String(repeating: "b", count: 64),
            x: 0,
            y: 0,
            width: 8193,
            height: 720
        )
        XCTAssertThrowsError(try request.validated(expectedToken: request.token)) { error in
            XCTAssertEqual(error as? CaptureProtocolError, .invalidRegion)
            XCTAssertEqual(error.localizedDescription, "Capture region is invalid.")
        }
    }
}
```

- [ ] **Step 2: Run the Swift test to verify RED**

Run:

```bash
rtk swift test --package-path native/macos-capture-helper
```

Expected: FAIL because the package and protocol types do not exist.

- [ ] **Step 3: Add the package and exact protocol types**

Use macOS 14 and Swift 6. Define these public core types and constants; JSON requests are newline-delimited and response headers precede raw PNG bytes.

```swift
public let captureProtocolVersion = 1
public let maximumCaptureDimension = 8_192
public let maximumCaptureBytes = 32 * 1_024 * 1_024
public let maximumRequestBytes = 8 * 1_024

public struct CaptureBootstrap: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let socketPath: String
    public let token: String
    public let idleTimeoutMs: Int
}

public struct CaptureRequest: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let token: String
    public let x: Int
    public let y: Int
    public let width: Int
    public let height: Int
}

public struct CaptureResponseHeader: Codable, Equatable, Sendable {
    public let ok: Bool
    public let code: String?
    public let message: String?
    public let byteLength: Int?
    public let width: Int?
    public let height: Int?
}

public enum CaptureProtocolError: String, Error, LocalizedError, Sendable {
    case authenticationFailed = "capture_authentication_failed"
    case invalidRequest = "capture_request_invalid"
    case invalidRegion = "capture_region_invalid"
    case captureFailed = "native_window_capture_unavailable"
    case responseTooLarge = "capture_response_too_large"

    public var errorDescription: String? {
        switch self {
        case .authenticationFailed: "Capture helper authentication failed."
        case .invalidRequest: "Capture request is invalid."
        case .invalidRegion: "Capture region is invalid."
        case .captureFailed: "Native browser UI capture is unavailable."
        case .responseTooLarge: "Capture response exceeds the allowed size."
        }
    }
}
```

`validated(expectedToken:)` must require version `1`, a 64-character lowercase hexadecimal token, constant-time UTF-8 comparison, finite positive dimensions no greater than 8192, integer-safe `width * height`, and coordinates representable by `CGRect`.

- [ ] **Step 4: Run protocol tests and verify GREEN**

Run:

```bash
rtk swift test --package-path native/macos-capture-helper --filter CaptureProtocolTests
```

Expected: all protocol tests pass.

- [ ] **Step 5: Commit the protocol**

```bash
git add native/macos-capture-helper/Package.swift native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureProtocol.swift native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/CaptureProtocolTests.swift
git commit -m "WES-273: define native capture helper protocol"
```

### Task 2: Implement The On-Demand Same-User Capture Server

**Files:**

- Create: `native/macos-capture-helper/Sources/AutoDemoCaptureCore/UnixCaptureServer.swift`
- Create: `native/macos-capture-helper/Sources/AutoDemoCaptureCore/ScreenCaptureProvider.swift`
- Create: `native/macos-capture-helper/Sources/AutoDemoCaptureHelper/main.swift`
- Create: `native/macos-capture-helper/Resources/Info.plist`
- Test: `native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/UnixCaptureServerTests.swift`

- [ ] **Step 1: Write failing server behavior tests**

Start the server on a temporary socket with an injected provider returning a 2-by-2 PNG. Test socket mode `0600`, current-UID acceptance, wrong-token rejection, exact header and bytes, invalid region rejection before provider invocation, disconnect shutdown, and a 100 ms test idle timeout.

```swift
actor FakeCaptureProvider: CaptureProvider {
    private(set) var regions: [CGRect] = []
    let png: Data

    init(png: Data) { self.png = png }

    func capture(region: CGRect, outputSize: CGSize) async throws -> Data {
        regions.append(region)
        return png
    }
}

func testServesOneAuthenticatedCurrentUser() async throws {
    let harness = try await ServerHarness.start(idleTimeoutMs: 1_000)
    let response = try await harness.capture(width: 2, height: 2)
    XCTAssertEqual(response.header, CaptureResponseHeader(
        ok: true,
        code: nil,
        message: nil,
        byteLength: response.png.count,
        width: 2,
        height: 2
    ))
    XCTAssertEqual(response.png, harness.expectedPng)
    XCTAssertEqual(try socketMode(harness.socketPath), 0o600)
}
```

- [ ] **Step 2: Run server tests to verify RED**

Run:

```bash
rtk swift test --package-path native/macos-capture-helper --filter UnixCaptureServerTests
```

Expected: FAIL because the provider and server do not exist.

- [ ] **Step 3: Implement the provider and POSIX server**

Define the injected boundary:

```swift
public protocol CaptureProvider: Sendable {
    func capture(region: CGRect, outputSize: CGSize) async throws -> Data
}
```

`ScreenCaptureKitProvider.capture` must:

1. call `SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)`;
2. find the `SCDisplay` whose `CGDisplayBounds(displayID)` fully contains the global requested rectangle;
3. convert the rectangle to display-local coordinates;
4. configure `SCStreamConfiguration.sourceRect`, exact integer `width` and `height`, `showsCursor = false`, and `capturesAudio = false`;
5. call `SCScreenshotManager.captureImage(contentFilter:configuration:)`;
6. encode PNG through `CGImageDestination` and reject zero bytes or more than 32 MiB.

`UnixCaptureServer` must create `AF_UNIX/SOCK_STREAM`, unlink only its exact validated socket path, bind, `chmod` to `0600`, listen with backlog `1`, enforce `getpeereid(clientFd) == getuid()`, read at most 8 KiB through the first newline, validate the token and region, write one JSON header plus newline and then raw PNG bytes, and close the client. It accepts sequential requests until its owner closes it or the configured 30-second idle timer fires. Signals and thrown errors close file descriptors and remove only the owned socket.

- [ ] **Step 4: Implement executable modes and app metadata**

`main.swift` supports only these bounded modes:

```text
--version-json
--preflight-json
--request-permission-json
--serve-bootstrap /absolute/path/to/capture-helper-bootstrap.json
```

Use `CGPreflightScreenCaptureAccess()` and `CGRequestScreenCaptureAccess()` only inside the installed helper process. `--serve-bootstrap` rejects symlinks, files not owned by the current user, modes broader than `0600`, files above 16 KiB, non-absolute paths, protocol mismatch, socket paths above `sockaddr_un.sun_path`, and idle timeouts outside 1,000 through 30,000 ms.

The tracked Info.plist must contain:

```xml
<key>CFBundleIdentifier</key><string>com.autodemo.capture-helper</string>
<key>CFBundleName</key><string>Auto Demo Capture</string>
<key>CFBundleExecutable</key><string>AutoDemoCaptureHelper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>LSUIElement</key><true/>
<key>NSScreenCaptureUsageDescription</key>
<string>Auto Demo captures browser UI selected during a local demo discovery session.</string>
```

- [ ] **Step 5: Verify the complete Swift package**

Run:

```bash
rtk swift test --package-path native/macos-capture-helper
rtk swift build --package-path native/macos-capture-helper -c release
```

Expected: all Swift tests pass and the release executable builds without warnings.

- [ ] **Step 6: Commit the helper server**

```bash
git add native/macos-capture-helper/Sources native/macos-capture-helper/Resources native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/UnixCaptureServerTests.swift
git commit -m "WES-273: add on-demand macOS capture helper"
```

### Task 3: Add Safe Local Build, Signing, Installation, And Permission Setup

**Files:**

- Create: `packages/cli/src/macosCaptureHelperSetup.ts`
- Test: `packages/cli/src/macosCaptureHelperSetup.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Write failing setup and CLI tests**

Inject filesystem and child-command ports. Cover non-macOS, zero/one/multiple Apple Development identities, exclusion of Developer ID identities, explicit fingerprint selection, explicit `--ad-hoc`, invalid fingerprints, build failure, signature failure, atomic replacement rollback, permission-required output, already-current install, and JSON privacy.

```ts
expect(
  parseCodeSigningIdentities(`
  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: Example Developer (EXAMPLE1)"
  2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Developer ID Application: Example Inc (EXAMPLE2)"
`),
).toEqual([
  {
    fingerprint: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    label: "Apple Development: Example Developer (EXAMPLE1)",
  },
]);

expect(await runSetup({ json: true }, multipleIdentities())).toMatchObject({
  ok: false,
  code: "signing_identity_required",
  choices: [{ fingerprint: expect.stringMatching(/^[A-F0-9]{40}$/) }],
});
expect(JSON.stringify(trackedWrites)).not.toContain("Local User");
```

- [ ] **Step 2: Run setup tests to verify RED**

Run:

```bash
rtk npx vitest run src/macosCaptureHelperSetup.test.ts src/index.test.ts
```

from `packages/cli`.

Expected: FAIL because the setup module and command do not exist.

- [ ] **Step 3: Implement setup result and dependency boundaries**

Export only the command runner and public result:

```ts
export type CaptureHelperSetupResult =
  | {
      ok: true;
      code: "capture_helper_ready";
      installPath: string;
      signature: "development" | "ad-hoc";
    }
  | {
      ok: false;
      code:
        | "unsupported_platform"
        | "signing_identity_required"
        | "invalid_signing_identity"
        | "capture_helper_build_failed"
        | "capture_helper_install_failed"
        | "capture_helper_signature_invalid"
        | "capture_helper_permission_required";
      message: string;
      choices?: Array<{ fingerprint: string; label: string }>;
    };

export type CaptureHelperSetupInput = {
  signingIdentity?: string;
  adHoc: boolean;
  json: true;
};
```

Parse only `security find-identity -v -p codesigning` lines with a 40-character uppercase hexadecimal fingerprint and a quoted label beginning `Apple Development:`. Never auto-select a `Developer ID Application:` label. Exactly one eligible identity may be selected automatically; zero or multiple return `signing_identity_required` without running Swift or codesign.

- [ ] **Step 4: Implement build, package, sign, verify, and atomic install**

Use a temporary directory from `mkdtemp`. Run:

Construct these exact child-process argument arrays from the injected `repositoryRoot`, `temporaryDirectory`, and selected `signingIdentity` values:

```ts
[
  "swift",
  [
    "build",
    "--package-path",
    join(repositoryRoot, "native/macos-capture-helper"),
    "--configuration",
    "release",
    "--scratch-path",
    join(temporaryDirectory, "swift"),
  ],
]
[
  "codesign",
  [
    "--force",
    "--sign",
    signingIdentity,
    "--identifier",
    "com.autodemo.capture-helper",
    join(temporaryDirectory, "Auto Demo Capture.app"),
  ],
]
[
  "codesign",
  ["--verify", "--strict", "--verbose=2", join(temporaryDirectory, "Auto Demo Capture.app")],
]
```

Create only these app paths before signing:

```text
Contents/Info.plist
Contents/MacOS/AutoDemoCaptureHelper
Contents/Resources/source-hash
```

Compute `source-hash` from sorted relative paths and bytes under `native/macos-capture-helper`, excluding `.build`. Install at `~/Applications/Auto Demo Capture.app`. If an older install exists, rename it to a uniquely named sibling backup, rename the verified new app into place, run `--version-json`, and restore the backup on any failure. Remove only the temporary directory and successfully superseded backup. Never write a signing identity or app artifact inside a tracked repository path.

- [ ] **Step 5: Wire the public CLI command**

Accept exactly:

```text
autodemo setup capture-helper --json
autodemo setup capture-helper --signing-identity "$CAPTURE_HELPER_SIGNING_FINGERPRINT" --json
autodemo setup capture-helper --ad-hoc --json
```

Reject combining `--ad-hoc` and `--signing-identity`. After installation, invoke the installed app with `--preflight-json`; when denied, invoke `--request-permission-json` once and return `capture_helper_permission_required` unless the helper itself reports permission granted. Do not open a target browser during setup.

Add these ignored build artifacts:

```gitignore
native/macos-capture-helper/.build/
native/macos-capture-helper/*.xcodeproj/
Auto Demo Capture.app/
```

- [ ] **Step 6: Verify setup behavior**

Run:

```bash
rtk npx vitest run src/macosCaptureHelperSetup.test.ts src/index.test.ts
rtk npm run typecheck --workspace @auto-demo/cli
rtk git diff --check
```

Expected: tests and typecheck pass; diff check reports no whitespace errors.

- [ ] **Step 7: Commit setup support**

```bash
git add .gitignore packages/cli/src/macosCaptureHelperSetup.ts packages/cli/src/macosCaptureHelperSetup.test.ts packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/package.json
git commit -m "WES-273: install signed capture helper locally"
```

### Task 4: Add The Authenticated TypeScript Helper Client

**Files:**

- Create: `packages/agent/src/macOsCaptureHelperClient.ts`
- Test: `packages/agent/src/macOsCaptureHelperClient.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing client behavior tests**

Use a fake helper process and real temporary Unix socket. Cover `0600` bootstrap creation, 64-hex token, no token in spawn arguments or errors, protocol/version preflight, successful exact PNG, timeout, early EOF, malformed header, oversized header, oversized PNG, dimension mismatch, nonzero exit, close idempotence, and bootstrap/socket cleanup.

```ts
const client = await createMacOsCaptureHelperClient({
  sessionDirectory,
  installPath,
  requestTimeoutMs: 5_000,
  dependencies: fakeHelper({ png: exactPng(320, 240) }),
});

expect(await client.capture({ x: 40, y: 120, width: 320, height: 240 })).toEqual(
  exactPng(320, 240),
);
expect(fake.spawnArgs.join(" ")).not.toContain(fake.token);
expect((await stat(fake.bootstrapPath)).mode & 0o777).toBe(0o600);
await client.close();
```

- [ ] **Step 2: Run client tests to verify RED**

Run:

```bash
rtk npx vitest run src/macOsCaptureHelperClient.test.ts
```

from `packages/agent`.

Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement preflight and session client contracts**

```ts
export type MacOsCaptureRegion = { x: number; y: number; width: number; height: number };

export type MacOsCaptureHelperClient = {
  capture(region: MacOsCaptureRegion): Promise<Uint8Array | undefined>;
  close(): Promise<void>;
};

export type MacOsCaptureHelperPreflightResult =
  | { ok: true; installPath: string; protocolVersion: 1 }
  | {
      ok: false;
      code:
        | "capture_helper_not_installed"
        | "capture_helper_signature_invalid"
        | "capture_helper_protocol_mismatch"
        | "capture_helper_permission_required";
      message: string;
      setupCommand: "npm run autodemo -- setup capture-helper --json";
    };
```

Resolve the default install only as `join(homedir(), "Applications", "Auto Demo Capture.app")`. Preflight rejects symlinks, requires a regular executable at `Contents/MacOS/AutoDemoCaptureHelper`, runs `codesign --verify --strict`, then calls `--version-json` and `--preflight-json` with 2-second timeouts. Do not include child stderr in public errors.

- [ ] **Step 4: Implement authenticated socket capture and cleanup**

Create `capture-helper-bootstrap.json` with `flag: "wx"`, mode `0600`, protocol `1`, random 32-byte hex token, session-local socket path, and idle timeout 30,000. Spawn the installed executable with the argument array `["--serve-bootstrap", bootstrapPath]`. Wait at most two seconds for the socket. For every request, open a new socket connection, send one bounded JSON line, read a header line no larger than 8 KiB, validate `ok`, `byteLength <= 32 MiB`, and exact requested dimensions, then read exactly that many bytes and reject trailing protocol data. A five-second timer destroys the socket. `close()` sends `SIGTERM`, waits two seconds, then `SIGKILL`s only the owned still-running child, closes sockets, and removes only the owned bootstrap and socket paths.

- [ ] **Step 5: Verify client tests and exports**

Run:

```bash
rtk npx vitest run src/macOsCaptureHelperClient.test.ts
rtk npm run typecheck --workspace @auto-demo/agent
```

Expected: all focused tests and typecheck pass.

- [ ] **Step 6: Commit the client**

```bash
git add packages/agent/src/macOsCaptureHelperClient.ts packages/agent/src/macOsCaptureHelperClient.test.ts packages/agent/src/index.ts packages/agent/package.json
git commit -m "WES-273: connect to native capture helper"
```

### Task 5: Replace Direct Screen Capture And Preflight Before Browser Navigation

**Files:**

- Modify: `packages/agent/src/macOsBrowserWindowCapture.ts`
- Modify: `packages/agent/src/macOsBrowserWindowCapture.test.ts`
- Modify: `packages/agent/src/playwrightCoordinateDiscoveryPage.ts`
- Modify: `packages/agent/src/playwrightCoordinateDiscoveryPage.test.ts`
- Modify: `packages/cli/src/playwrightDiscoverRuntime.ts`
- Modify: `packages/cli/src/coordinateDiscoveryAcceptance.test.ts`

- [ ] **Step 1: Write failing adapter and runtime tests**

Assert that macOS capture uses the helper client, normalizes Retina/exact output as before, closes the helper once, returns setup guidance before calling the browser launcher when preflight fails, and closes both browser and helper on abandon, runtime failure, and host shutdown.

```ts
it("fails before target navigation when helper permission is missing", async () => {
  const launchedUrls: string[] = [];
  const result = await createPlaywrightDiscoverRuntime(bootstrap, {
    async preflightCaptureHelper() {
      return {
        ok: false,
        code: "capture_helper_permission_required",
        message: "Auto Demo Capture needs Screen Recording permission.",
        setupCommand: "npm run autodemo -- setup capture-helper --json",
      };
    },
    async launchBrowser(input) {
      launchedUrls.push(input.url);
      throw new Error("must not launch");
    },
  });
  expect(result.initialResponse).toMatchObject({
    ok: false,
    code: "capture_helper_permission_required",
  });
  expect(launchedUrls).toEqual([]);
});
```

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
rtk npx vitest run src/macOsBrowserWindowCapture.test.ts src/playwrightCoordinateDiscoveryPage.test.ts
rtk npx vitest run src/coordinateDiscoveryAcceptance.test.ts
```

from `packages/agent` and `packages/cli` respectively.

Expected: FAIL because direct `screencapture` remains and runtime preflight is absent.

- [ ] **Step 3: Replace the native capture implementation**

Change the shared boundary to:

```ts
export type BrowserWindowCapture = {
  capture(): Promise<Uint8Array | undefined>;
  close?(): Promise<void>;
};
```

`createMacOsBrowserWindowCapture(page, { client })` retains viewport-region calculation but calls `client.capture(region)` rather than `/usr/sbin/screencapture`. Delete child-process, temporary-file, and direct screen-capture code. Continue decoding and normalizing the returned PNG to exact viewport dimensions. Its `close` delegates to the client.

- [ ] **Step 4: Wire preflight and owned cleanup**

Before `createPlaywrightDiscoveryBrowserLauncher().launch`, macOS runtime creation calls `preflightMacOsCaptureHelper()`. A failed result becomes the exact initial response including `setupCommand`; no browser launches. A successful preflight creates one helper client for the session, passes it into the window-capture adapter, and stores an idempotent cleanup function. Runtime `close`, abandon, initialization failures, and unexpected host closure await helper cleanup and browser cleanup independently so one failure cannot skip the other.

- [ ] **Step 5: Verify affected agent and CLI behavior**

Run:

```bash
rtk npx vitest run src/macOsCaptureHelperClient.test.ts src/macOsBrowserWindowCapture.test.ts src/playwrightCoordinateDiscoveryPage.test.ts src/coordinateDiscoverySession.test.ts
rtk npx vitest run src/coordinateDiscoveryAcceptance.test.ts
rtk npm run typecheck --workspace @auto-demo/agent
rtk npm run typecheck --workspace @auto-demo/cli
```

Expected: all tests and typechecks pass.

- [ ] **Step 6: Commit runtime integration**

```bash
git add packages/agent/src/macOsBrowserWindowCapture.ts packages/agent/src/macOsBrowserWindowCapture.test.ts packages/agent/src/playwrightCoordinateDiscoveryPage.ts packages/agent/src/playwrightCoordinateDiscoveryPage.test.ts packages/cli/src/playwrightDiscoverRuntime.ts packages/cli/src/coordinateDiscoveryAcceptance.test.ts
git commit -m "WES-273: capture native dropdowns through helper"
```

### Task 6: Publish Setup And Privacy Documentation

**Files:**

- Modify: `README.md`
- Modify: `packages/cli/README.md`
- Modify: `docs/guides/screenshot-coordinate-discovery.md`
- Modify: `packages/cli/src/packaging-docs.test.ts`
- Modify: `docs/superpowers/specs/2026-07-21-screenshot-coordinate-cli-discovery-design.md`
- Modify: `docs/superpowers/plans/2026-07-21-screenshot-coordinate-cli-discovery-implementation-plan.md`

- [ ] **Step 1: Write failing documentation contract tests**

Require the public guide to include the setup command, exact install location, helper bundle identifier, Apple Development versus explicit ad-hoc behavior, no-certificate-in-repo guarantee, permission preflight, `capture_helper_permission_required`, on-demand shutdown, and provider neutrality. Require removal of direct `/usr/sbin/screencapture` instructions.

```ts
expect(guide).toContain("npm run autodemo -- setup capture-helper --json");
expect(guide).toContain("~/Applications/Auto Demo Capture.app");
expect(guide).toContain("capture_helper_permission_required");
expect(guide).toContain("certificate and private key remain in the macOS Keychain");
expect(guide).not.toContain("/usr/sbin/screencapture");
```

- [ ] **Step 2: Run docs tests to verify RED**

Run:

```bash
rtk npx vitest run src/packaging-docs.test.ts
```

from `packages/cli`.

Expected: FAIL because the published guide still describes direct native-window capture permission.

- [ ] **Step 3: Update public docs and the original implementation plan**

Document this operator sequence exactly:

```bash
npm run build
npm run autodemo -- setup capture-helper --json
# If multiple local Apple Development identities are returned:
read -r CAPTURE_HELPER_SIGNING_FINGERPRINT
npm run autodemo -- setup capture-helper --signing-identity "$CAPTURE_HELPER_SIGNING_FINGERPRINT" --json
# Public contributors without a certificate may explicitly choose:
npm run autodemo -- setup capture-helper --ad-hoc --json
```

Explain that fingerprints identify local Keychain entries and are not private keys, no certificate material or built app is committed, organization Developer ID identities are never auto-selected, permission belongs to `com.autodemo.capture-helper`, and the helper exits with the discovery session. Replace the direct-screencapture step in the original implementation plan with a reference to this approved helper plan and mark already delivered original tasks accurately from git evidence.

- [ ] **Step 4: Verify docs and privacy scans**

Run:

```bash
rtk npx vitest run src/packaging-docs.test.ts
rtk rg -n "BEGIN (RSA |EC |)PRIVATE KEY|BEGIN CERTIFICATE" --glob '!node_modules/**' --glob '!workflow/**' .
rtk git status --short
rtk git diff --check
```

Expected: docs tests pass; privacy scan finds no committed personal identity, fingerprint, company signing identity, or private key; diff check passes.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md packages/cli/README.md docs/guides/screenshot-coordinate-discovery.md packages/cli/src/packaging-docs.test.ts docs/superpowers/specs/2026-07-21-screenshot-coordinate-cli-discovery-design.md docs/superpowers/plans/2026-07-21-screenshot-coordinate-cli-discovery-implementation-plan.md docs/superpowers/plans/2026-07-21-on-demand-macos-capture-helper.md
git commit -m "WES-273: document model-neutral capture setup"
```

### Task 7: Install The Real Helper And Prove Native Capture Locally

**Files:**

- Modify only if a product defect is found through RED-GREEN evidence in Tasks 1 through 6.

- [ ] **Step 1: Build and list eligible local signing choices**

Run:

```bash
npm run build
npm run autodemo -- setup capture-helper --json
```

Expected on this Mac: `signing_identity_required` with only Apple Development choices; no Developer ID choice appears and no target browser opens.

- [ ] **Step 2: Install with the user-selected personal Apple Development fingerprint**

Use the fingerprint returned by Step 1 at runtime; do not paste it into tracked docs, scripts, plans, tests, comments, or commits.

```bash
read -r CAPTURE_HELPER_SIGNING_FINGERPRINT
npm run autodemo -- setup capture-helper --signing-identity "$CAPTURE_HELPER_SIGNING_FINGERPRINT" --json
```

Expected: the helper installs at `~/Applications/Auto Demo Capture.app` and either returns `capture_helper_ready` or `capture_helper_permission_required` after opening the helper-owned macOS permission request.

- [ ] **Step 3: Complete the one-time permission grant and rerun setup**

Enable only `Auto Demo Capture` in System Settings when prompted, then rerun the exact Step 2 command.

Expected: `capture_helper_ready` with signature `development`.

- [ ] **Step 4: Run the real native-popup capability check**

Launch the local headed fixture through the public discovery CLI, click its native select by screenshot coordinate, and assert the returned `popup_opened` frame is a valid exact-size PNG produced while the popup is visible. Close with `discover abandon` and verify no `AutoDemoCaptureHelper` process or session socket remains after 30 seconds.

- [ ] **Step 5: Record local capability evidence without personal signing data**

Add only generic evidence to the issue plan and project map: helper protocol version, development-signed versus ad-hoc, permission preflight pass, PNG dimensions, cleanup pass, commands, and test counts. Do not record the certificate label, fingerprint, Team ID, Keychain path, or code-signature dump.

### Task 8: Restart Fresh Codex Acceptance And Finish Delivery

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: `docs/superpowers/plans/2026-07-21-screenshot-coordinate-cli-discovery-implementation-plan.md`

- [ ] **Step 1: Run full verification from clean generated artifacts**

Run:

```bash
rtk npm run validate
rtk swift test --package-path native/macos-capture-helper
rtk swift build --package-path native/macos-capture-helper -c release
rtk git diff --check
```

Expected: all workspace build, typecheck, lint, tests, formatting, Swift tests/build, and diff checks pass. Any preserved unrelated formatting failure must be named with its exact path and excluded only if it predates WES-273.

- [ ] **Step 2: Create a brand-new clean acceptance clone**

Clone the current committed branch with `--no-hardlinks`, run `npm ci`, build, and give a fresh ephemeral Codex xhigh session only the committed screenshot-coordinate guide plus the exact WES-273 Cars.com prompt. Do not provide source, selectors, old workflow artifacts, prior session IDs, DOM guidance, or Cars.com-specific corrections.

- [ ] **Step 3: Stop at the replay-validated review gate**

The fresh agent must select New, Kia, Sorento, and All miles; open the first actual listing in normal result order; finish semantic replay; and present every sanitized step, warning, question, assumption, and blocker. Record duration, turns, screenshots, action batches, observation boundaries, repairs, recoveries, and provider-neutrality. Stop for the user's explicit approval.

- [ ] **Step 4: After explicit approval, execute and hand off only**

Approve the exact reviewed plan, execute it in freshly selected YOLO mode, and create `./demos/cars-kia-sorento`. Validate the project and run it through the public CLI. Do not open the editor or export MP4.

- [ ] **Step 5: Run independent review and publish**

Obtain the required independent read-only review of the complete issue diff. Resolve Critical and Important findings with RED-GREEN evidence. Push the branch, open a PR against `develop`, monitor all checks, merge only when green, and fast-forward local `develop` without touching unrelated dirty files.

- [ ] **Step 6: Synchronize Linear and the project map**

Add WES-275 as the deferred Claude acceptance follow-up in `docs/linear/auto-demo-project-structure.md`. Comment on WES-273 with generic helper capability evidence, acceptance metrics, PR, merge commit, checks, and handoff path. Close WES-273 only after merged repository truth, Linear, and the project map agree. Leave WES-275 in Backlog.

- [ ] **Step 7: Final delivery handoff**

Report `What was delivered`, `What's next`, and `Efficiency retrospective`. Name the helper setup command, acceptance metrics, verification commands, PR/merge evidence, WES-275 follow-up, and preserved unrelated dirty paths. Use `No efficiency findings to report.` when there is no concrete improvement to record.
