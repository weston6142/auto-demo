# WES-273 macOS Capture Helper Supervision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the signed `Auto Demo Capture.app` own Screen Recording permission and session lifecycle through a native Launch Services supervisor, prove the real macOS capture boundary, and complete WES-273's prompt-only Cars.com acceptance.

**Architecture:** Add a private launch-request/result contract and a Swift supervisor executable inside the signed app bundle. Node owns the supervisor, the supervisor launches and terminates one exact `NSRunningApplication`, and the capture app retains the existing authenticated Unix-socket protocol; no direct inner-helper launch or model-host permission fallback remains.

**Tech Stack:** Swift 6, AppKit `NSWorkspace`/`NSRunningApplication`, CoreGraphics, ScreenCaptureKit, POSIX signals and private files, TypeScript, Node.js child processes and filesystem APIs, Vitest, GitHub Actions, existing Auto Demo CLI/discovery contracts.

---

## File Responsibilities

- `native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureLaunchProtocol.swift`: versioned private launch request/result modes, file validation, bounded result persistence, and public error codes shared by helper and supervisor.
- `native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureApplicationSupervisor.swift`: platform-neutral supervision state machine over injected launch/application handles.
- `native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureHelperMode.swift`: testable supervised helper-mode dispatch over injected permission and service operations.
- `native/macos-capture-helper/Sources/AutoDemoCaptureSupervisor/AppKitCaptureApplicationLauncher.swift`: production AppKit adapter that launches the enclosing app bundle and wraps `NSRunningApplication`.
- `native/macos-capture-helper/Sources/AutoDemoCaptureSupervisor/main.swift`: supervisor entry point, signal handling, launch request loading, and bounded exit mapping.
- `native/macos-capture-helper/Sources/AutoDemoCaptureHelper/main.swift`: capture-app modes that consume a supervised request, perform permission/version/service work, and persist one-shot results.
- `native/macos-capture-helper/Package.swift`: supervisor executable target and AppKit-linked product.
- `packages/agent/src/macOsCaptureHelperClient.ts`: supervisor probe utility, runtime preflight, session launch, socket capture, and owned cleanup.
- `packages/cli/src/macosCaptureHelperSetup.ts`: build/sign/install both executables and use supervised probes for version and permission.
- `.github/workflows/ci.yml`: focused macOS Swift build/unit/bundle job and aggregate-gate dependency.
- `docs/guides/screenshot-coordinate-discovery.md` and `packages/cli/README.md`: truthful Launch Services setup, supervision, permission, and recovery contract.

### Task 1: Define The Private Launch Contract

**Files:**

- Create: `native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureLaunchProtocol.swift`
- Create: `native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/CaptureLaunchProtocolTests.swift`

- [ ] **Step 1: Write failing request-validation tests**

Define tests for the exact public API below:

```swift
func testLoadsPrivateVersionProbeRequest() throws {
    let fixture = try LaunchRequestFixture(mode: .version)
    defer { fixture.cleanup() }

    let loaded = try loadPrivateCaptureLaunchRequest(path: fixture.requestPath)

    XCTAssertEqual(loaded.request.protocolVersion, captureProtocolVersion)
    XCTAssertEqual(loaded.request.mode, .version)
    XCTAssertEqual(loaded.request.responsePath, fixture.responsePath)
    XCTAssertNil(loaded.request.bootstrapPath)
}

func testRejectsWorldReadableRequest() throws {
    let fixture = try LaunchRequestFixture(mode: .permissionPreflight, requestMode: 0o644)
    defer { fixture.cleanup() }

    XCTAssertThrowsError(try loadPrivateCaptureLaunchRequest(path: fixture.requestPath))
}

func testRejectsProbeResponseOutsidePrivateRequestDirectory() throws {
    let fixture = try LaunchRequestFixture(mode: .permissionRequest, externalResponse: true)
    defer { fixture.cleanup() }

    XCTAssertThrowsError(try loadPrivateCaptureLaunchRequest(path: fixture.requestPath))
}

func testRejectsServiceRequestWithoutPrivateBootstrap() throws {
    let fixture = try LaunchRequestFixture(mode: .service, createBootstrap: false)
    defer { fixture.cleanup() }

    XCTAssertThrowsError(try loadPrivateCaptureLaunchRequest(path: fixture.requestPath))
}

func testWritesOneBoundedResponseWithoutReplacingExistingPath() throws {
    let fixture = try LaunchRequestFixture(mode: .version)
    defer { fixture.cleanup() }
    let result = CaptureLaunchResult.success(code: "capture_helper_version", values: [
        "protocolVersion": .integer(captureProtocolVersion),
        "bundleIdentifier": .string("com.autodemo.capture-helper"),
    ])

    try writePrivateCaptureLaunchResult(result, path: fixture.responsePath)

    XCTAssertEqual(try loadPrivateCaptureLaunchResult(path: fixture.responsePath), result)
    XCTAssertThrowsError(try writePrivateCaptureLaunchResult(result, path: fixture.responsePath))
}
```

The test fixture must create an owner-only temporary directory, a regular `0600` request, an optional regular `0600` bootstrap, and an initially nonexistent response path. Add cases for symlinked request/bootstrap, wrong owner when injectable metadata is used, NUL/relative paths, response path collision, invalid mode fields, oversized request/result, and mismatched mode-specific fields.

- [ ] **Step 2: Run Swift tests and verify RED**

Run:

```bash
rtk swift test --package-path native/macos-capture-helper --filter CaptureLaunchProtocolTests
```

Expected: FAIL because `CaptureLaunchProtocol`, `CaptureLaunchMode`, `CaptureLaunchResult`, and the private load/write functions do not exist.

- [ ] **Step 3: Implement the minimal launch contract**

Implement these exact types and entry points:

```swift
public enum CaptureLaunchMode: String, Codable, Sendable {
    case version
    case permissionPreflight = "permission-preflight"
    case permissionRequest = "permission-request"
    case service
}

public enum CaptureLaunchValue: Codable, Equatable, Sendable {
    case integer(Int)
    case string(String)
}

public struct CaptureLaunchRequest: Codable, Equatable, Sendable {
    public let protocolVersion: Int
    public let mode: CaptureLaunchMode
    public let responsePath: String?
    public let bootstrapPath: String?
}

public struct ValidatedCaptureLaunchRequest: Equatable, Sendable {
    public let requestPath: String
    public let request: CaptureLaunchRequest
}

public struct CaptureLaunchResult: Codable, Equatable, Sendable {
    public let ok: Bool
    public let code: String
    public let message: String?
    public let values: [String: CaptureLaunchValue]

    public static func success(
        code: String,
        values: [String: CaptureLaunchValue] = [:]
    ) -> Self
    public static func failure(code: String, message: String) -> Self
}

public func loadPrivateCaptureLaunchRequest(
    path: String
) throws -> ValidatedCaptureLaunchRequest

public func loadPrivateCaptureLaunchResult(path: String) throws -> CaptureLaunchResult

public func writePrivateCaptureLaunchResult(
    _ result: CaptureLaunchResult,
    path: String
) throws
```

Use `lstat`, current UID checks, `S_IFREG`/`S_IFDIR`, `0o077 == 0`, absolute/NUL-free paths, a 16 KiB request/result bound, same-private-directory response enforcement, `O_CREAT | O_EXCL | O_NOFOLLOW` with mode `0600`, and complete bounded writes. A service request requires only `bootstrapPath`; probe modes require only `responsePath`.

- [ ] **Step 4: Run Swift tests and verify GREEN**

Run the Step 2 command. Expected: all `CaptureLaunchProtocolTests` pass.

- [ ] **Step 5: Commit the private protocol**

```bash
rtk git add native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureLaunchProtocol.swift native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/CaptureLaunchProtocolTests.swift
rtk git commit -m "WES-273: define private capture launch protocol"
```

### Task 2: Supervise One Exact Launch Services Application

**Files:**

- Create: `native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureApplicationSupervisor.swift`
- Create: `native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/CaptureApplicationSupervisorTests.swift`
- Create: `native/macos-capture-helper/Sources/AutoDemoCaptureSupervisor/AppKitCaptureApplicationLauncher.swift`
- Create: `native/macos-capture-helper/Sources/AutoDemoCaptureSupervisor/main.swift`
- Modify: `native/macos-capture-helper/Package.swift`

- [ ] **Step 1: Write failing supervision tests**

Use injected handles so unit tests assert behavior rather than AppKit internals:

```swift
func testLaunchesFreshNonActivatingEnclosingApplication() async throws {
    let fixture = SupervisorFixture()
    let supervisor = CaptureApplicationSupervisor(
        launcher: fixture.launcher,
        terminationGrace: .milliseconds(100),
        pollInterval: .milliseconds(1)
    )

    try await supervisor.run(request: fixture.serviceRequest)

    XCTAssertEqual(await fixture.launcher.requests(), [
        CaptureApplicationLaunch(
            applicationURL: fixture.enclosingApplicationURL,
            arguments: ["--supervised-request", fixture.requestPath],
            createsNewInstance: true,
            activates: false,
            allowsSubstitution: false
        )
    ])
}

func testGracefullyTerminatesExactApplicationOnShutdown() async throws {
    let fixture = SupervisorFixture(applicationTerminatesGracefully: true)
    let supervisor = fixture.supervisor()
    let running = Task { try await supervisor.run(request: fixture.serviceRequest) }
    await fixture.waitUntilLaunched()

    await supervisor.shutdown()
    try await running.value

    XCTAssertEqual(await fixture.application.actions(), [.terminate])
}

func testForceTerminatesOnlyAfterGracePeriod() async throws {
    let fixture = SupervisorFixture(applicationTerminatesGracefully: false)
    let supervisor = fixture.supervisor()
    let running = Task { try await supervisor.run(request: fixture.serviceRequest) }
    await fixture.waitUntilLaunched()

    await supervisor.shutdown()
    try await running.value

    XCTAssertEqual(await fixture.application.actions(), [.terminate, .forceTerminate])
}
```

Add tests for launch failure, early child exit, probe completion, repeated shutdown, and enclosing-bundle derivation that rejects a supervisor outside `Contents/MacOS`.

- [ ] **Step 2: Run focused Swift tests and verify RED**

```bash
rtk swift test --package-path native/macos-capture-helper --filter CaptureApplicationSupervisorTests
```

Expected: FAIL because the supervision abstractions and supervisor target do not exist.

- [ ] **Step 3: Implement the platform-neutral supervision state machine**

Define:

```swift
public struct CaptureApplicationLaunch: Equatable, Sendable {
    public let applicationURL: URL
    public let arguments: [String]
    public let createsNewInstance: Bool
    public let activates: Bool
    public let allowsSubstitution: Bool
}

public protocol CaptureRunningApplication: Sendable {
    func isTerminated() async -> Bool
    func terminate() async -> Bool
    func forceTerminate() async -> Bool
}

public protocol CaptureApplicationLaunching: Sendable {
    func launch(_ request: CaptureApplicationLaunch) async throws
        -> any CaptureRunningApplication
}

public actor CaptureApplicationSupervisor {
    public init(
        launcher: any CaptureApplicationLaunching,
        terminationGrace: Duration = .seconds(2),
        pollInterval: Duration = .milliseconds(50)
    )

    public func run(request: ValidatedCaptureLaunchRequest) async throws
    public func shutdown() async
}

public func enclosingCaptureApplicationURL(supervisorExecutableURL: URL) throws -> URL
```

`run` launches exactly once, waits until the returned handle terminates, and never chooses another bundle. `shutdown` is idempotent; it sends graceful termination, polls for the configured grace period, and force-terminates only the retained handle.

- [ ] **Step 4: Implement the AppKit adapter and executable target**

Add an executable product/target named `AutoDemoCaptureSupervisor` depending on `AutoDemoCaptureCore`. The production adapter must create:

```swift
let configuration = NSWorkspace.OpenConfiguration()
configuration.arguments = request.arguments
configuration.activates = false
configuration.createsNewApplicationInstance = true
configuration.allowsRunningApplicationSubstitution = false
configuration.addsToRecentItems = false
```

Launch with `NSWorkspace.shared.openApplication(at:configuration:)`, wrap the returned `NSRunningApplication`, and map all arbitrary AppKit errors to the fixed `capture_helper_unavailable` exit path. The supervisor entry point accepts exactly `--launch-request <absolute-path>`, installs `SIGTERM` and `SIGINT` dispatch sources, calls `shutdown()`, and exits only after the state machine confirms termination or bounded escalation.

- [ ] **Step 5: Run Swift tests and build the supervisor**

```bash
rtk swift test --package-path native/macos-capture-helper
rtk swift build --package-path native/macos-capture-helper --configuration release
```

Expected: all Swift tests pass and release output contains both `AutoDemoCaptureHelper` and `AutoDemoCaptureSupervisor`.

- [ ] **Step 6: Commit supervision**

```bash
rtk git add native/macos-capture-helper/Package.swift native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureApplicationSupervisor.swift native/macos-capture-helper/Sources/AutoDemoCaptureSupervisor native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/CaptureApplicationSupervisorTests.swift
rtk git commit -m "WES-273: supervise capture app launch lifecycle"
```

### Task 3: Make The Capture App Consume Supervised Requests

**Files:**

- Create: `native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureHelperMode.swift`
- Modify: `native/macos-capture-helper/Sources/AutoDemoCaptureHelper/main.swift`
- Create: `native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/CaptureHelperModeTests.swift`

- [ ] **Step 1: Write failing helper-mode tests**

Extract mode execution behind injected permission and service operations and test this contract:

```swift
func testVersionModeWritesProtocolAndBundleIdentity() async throws {
    let fixture = try HelperModeFixture(mode: .version)
    defer { fixture.cleanup() }

    try await executeCaptureHelperRequest(
        fixture.request,
        permission: FakePermission(granted: true),
        serve: { _ in XCTFail("version mode must not serve") }
    )

    XCTAssertEqual(try fixture.result(), .success(
        code: "capture_helper_version",
        values: [
            "protocolVersion": .integer(captureProtocolVersion),
            "bundleIdentifier": .string("com.autodemo.capture-helper"),
        ]
    ))
}

func testPermissionPreflightDoesNotPrompt() async throws {
    let fixture = try HelperModeFixture(mode: .permissionPreflight)
    let permission = FakePermission(granted: false)

    try await executeCaptureHelperRequest(
        fixture.request,
        permission: permission,
        serve: { _ in }
    )

    XCTAssertEqual(await permission.actions(), [.preflight])
    XCTAssertEqual(try fixture.result().code, "capture_helper_permission_required")
}

func testServiceFailsBeforeSocketWhenPermissionIsMissing() async throws {
    let fixture = try HelperModeFixture(mode: .service)
    var served = false

    do {
        try await executeCaptureHelperRequest(
            fixture.request,
            permission: FakePermission(granted: false),
            serve: { _ in served = true }
        )
        XCTFail("expected permissionRequired")
    } catch {
        XCTAssertEqual(error as? CaptureHelperModeError, .permissionRequired)
    }

    XCTAssertFalse(served)
}
```

Add permission-request success/failure and valid-service-bootstrap cases.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
rtk swift test --package-path native/macos-capture-helper --filter CaptureHelperModeTests
```

Expected: FAIL because `executeCaptureHelperRequest` and injected permission behavior do not exist.

- [ ] **Step 3: Implement supervised helper modes**

Preserve current fixed JSON codes and define:

```swift
public protocol CapturePermissionChecking: Sendable {
    func preflight() async -> Bool
    func request() async -> Bool
}

public func executeCaptureHelperRequest(
    _ request: ValidatedCaptureLaunchRequest,
    permission: any CapturePermissionChecking,
    serve: @Sendable (String) async throws -> Void
) async throws
```

Implement the testable mode dispatch in `CaptureHelperMode.swift`. The capture executable accepts `--supervised-request <path>`, reloads and validates the private request, delegates to that core mode dispatcher, writes one-shot probe results with `writePrivateCaptureLaunchResult`, and keeps service output on the existing authenticated socket. Retain legacy direct `--version-json` only for developer diagnosis; Node setup/runtime must no longer use it. Remove direct permission-request/preflight from the public setup path.

- [ ] **Step 4: Run all Swift tests**

```bash
rtk swift test --package-path native/macos-capture-helper
```

Expected: all launch, supervisor, helper-mode, protocol, and server tests pass.

- [ ] **Step 5: Commit supervised helper modes**

```bash
rtk git add native/macos-capture-helper/Sources/AutoDemoCaptureCore/CaptureHelperMode.swift native/macos-capture-helper/Sources/AutoDemoCaptureHelper/main.swift native/macos-capture-helper/Tests/AutoDemoCaptureCoreTests/CaptureHelperModeTests.swift
rtk git commit -m "WES-273: run capture modes inside signed app"
```

### Task 4: Route TypeScript Preflight And Sessions Through The Supervisor

**Files:**

- Modify: `packages/agent/package.json`
- Modify: `packages/agent/src/macOsCaptureHelperClient.test.ts`
- Modify: `packages/agent/src/macOsCaptureHelperClient.ts`
- Modify: `packages/agent/src/index.ts`
- Create: `packages/agent/src/macOsCaptureHelperClient.local.test.ts`

- [ ] **Step 1: Write failing public-behavior tests**

Update the fixture to create both bundled executables and add assertions:

```typescript
it("probes the signed app through its bundled supervisor", async () => {
  const fixture = await helperFixture();
  const commands: Array<{ command: string; args: string[] }> = [];
  const result = await preflightMacOsCaptureHelper({
    ...fixture.dependencies,
    async runCommand(command, args) {
      commands.push({ command, args: [...args] });
      return await fixture.respondToCommand(command, args);
    },
  });

  expect(result).toMatchObject({ ok: true, protocolVersion: 1 });
  expect(commands.filter(({ args }) => args[0] === "--launch-request")).toHaveLength(2);
  expect(
    commands.some(({ command }) => command.endsWith("/Contents/MacOS/AutoDemoCaptureHelper")),
  ).toBe(false);
});

it("launches the session supervisor without exposing the token", async () => {
  const fixture = await helperFixture();
  let launchedExecutable = "";
  let launchArgs: string[] = [];
  const client = await createMacOsCaptureHelperClient({
    sessionDirectory: fixture.sessionDirectory,
    installPath: fixture.installPath,
    dependencies: {
      ...fixture.dependencies,
      launch(executable, args) {
        launchedExecutable = executable;
        launchArgs = [...args];
        return fixture.startServerFromLaunchRequest(args[1]!);
      },
    },
  });

  expect(launchedExecutable).toMatch(/AutoDemoCaptureSupervisor$/u);
  expect(launchArgs).toEqual(["--launch-request", expect.any(String)]);
  expect(launchArgs.join(" ")).not.toMatch(/[a-f0-9]{64}/u);
  await client.close();
});
```

Add missing-supervisor, malformed/late probe result, early supervisor exit, idempotent close, and launch-request cleanup cases.

- [ ] **Step 2: Run the focused agent test and verify RED**

```bash
rtk npm --workspace @auto-demo/agent exec vitest -- run src/macOsCaptureHelperClient.test.ts
```

Expected: FAIL because preflight and service launch still invoke `AutoDemoCaptureHelper` directly.

- [ ] **Step 3: Implement supervised probe and session utilities**

Add exact public/internal contracts:

```typescript
export type MacOsCaptureHelperProbeMode = "version" | "permission-preflight" | "permission-request";

export type MacOsCaptureHelperProbeResult = {
  ok: boolean;
  code: string;
  message?: string;
  values: Record<string, string | number>;
};

export async function runMacOsCaptureHelperProbe(input: {
  installPath: string;
  mode: MacOsCaptureHelperProbeMode;
  dependencies?: MacOsCaptureHelperDependencies;
}): Promise<MacOsCaptureHelperProbeResult | undefined>;
```

Use a `0700` temporary directory, `0600` launch request, initially absent response path, the bundled supervisor path, a ten-second command timeout, a 16 KiB result read bound, strict known-key JSON validation, and guaranteed cleanup. `preflightMacOsCaptureHelper` performs signature verification, version probe, then permission-preflight probe. `createMacOsCaptureHelperClient` writes a service launch request referring to the existing private bootstrap, launches the supervisor, monitors it during socket startup, and removes both request and bootstrap during close.

Add `macOsCaptureHelperClient.local.test.ts` to the package's existing `test` and `test:unit` scripts. Gate its single real-helper test with `it.runIf(process.platform === "darwin" && process.env.AUTODEMO_REAL_CAPTURE_HELPER === "1")`. The test must preflight successfully, create an owner-only temporary session directory, capture `{ x: 0, y: 0, width: 32, height: 32 }` through the public client, parse the returned bytes with `PNG.sync.read`, close the client, assert the session directory is empty, and remove the directory in guaranteed cleanup. It must not print or retain image bytes or private launch data.

- [ ] **Step 4: Run focused tests and agent typecheck**

```bash
rtk npm --workspace @auto-demo/agent exec vitest -- run src/macOsCaptureHelperClient.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
```

Expected: the focused suite and typecheck pass.

- [ ] **Step 5: Commit the TypeScript client correction**

```bash
rtk git add packages/agent/package.json packages/agent/src/macOsCaptureHelperClient.ts packages/agent/src/macOsCaptureHelperClient.test.ts packages/agent/src/macOsCaptureHelperClient.local.test.ts packages/agent/src/index.ts
rtk git commit -m "WES-273: launch capture sessions through supervisor"
```

### Task 5: Build, Install, And Probe The Complete Signed Bundle

**Files:**

- Modify: `packages/cli/src/macosCaptureHelperSetup.test.ts`
- Modify: `packages/cli/src/macosCaptureHelperSetup.ts`

- [ ] **Step 1: Write failing setup tests**

Require release build/install of both executables and supervised version/permission probes:

```typescript
it("installs both signed executables and probes through the supervisor", async () => {
  const fixture = await setupFixture({ identities: [identity("A")] });

  const result = await runMacOsCaptureHelperSetup(
    { adHoc: false, json: true },
    fixture.dependencies,
  );

  expect(result).toMatchObject({ ok: true, code: "capture_helper_ready" });
  await expect(
    stat(join(fixture.installPath, "Contents/MacOS/AutoDemoCaptureHelper")),
  ).resolves.toMatchObject({ mode: expect.any(Number) });
  await expect(
    stat(join(fixture.installPath, "Contents/MacOS/AutoDemoCaptureSupervisor")),
  ).resolves.toMatchObject({ mode: expect.any(Number) });
  expect(fixture.probes.map(({ mode }) => mode)).toEqual(["version", "permission-preflight"]);
});
```

Add rebuild, backup rollback, missing-supervisor, probe failure, explicit permission request, development/ad-hoc signing, and no-signing-data-in-result cases.

- [ ] **Step 2: Run the focused CLI test and verify RED**

```bash
rtk npm --workspace @auto-demo/cli exec vitest -- run src/macosCaptureHelperSetup.test.ts
```

Expected: FAIL because app creation copies only `AutoDemoCaptureHelper` and setup probes it directly.

- [ ] **Step 3: Install and probe both executables**

Extend `CaptureHelperSetupDependencies` with an injected `probeHelper` whose production value is `runMacOsCaptureHelperProbe`. Copy both release executables into `Contents/MacOS`, set mode `0755`, sign the entire app once, validate both regular non-symlinked files, and use version plus permission-preflight probes. If preflight reports permission required, run exactly one supervised permission-request probe and return the existing bounded result.

- [ ] **Step 4: Run focused tests and CLI typecheck**

```bash
rtk npm --workspace @auto-demo/cli exec vitest -- run src/macosCaptureHelperSetup.test.ts
rtk npm --workspace @auto-demo/cli run typecheck
```

Expected: focused setup tests and CLI typecheck pass.

- [ ] **Step 5: Commit signed-bundle setup**

```bash
rtk git add packages/cli/src/macosCaptureHelperSetup.ts packages/cli/src/macosCaptureHelperSetup.test.ts
rtk git commit -m "WES-273: install supervised capture app"
```

### Task 6: Add macOS CI And Public Contract Coverage

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/ci-policy.mjs`
- Modify: `scripts/ci-policy.test.mjs`
- Modify: `docs/guides/screenshot-coordinate-discovery.md`
- Modify: `packages/cli/README.md`
- Modify: `packages/cli/src/packaging-docs.test.ts`
- Modify: `docs/superpowers/specs/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-design.md`
- Modify: `docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md`

- [ ] **Step 1: Write failing CI policy and documentation tests**

Require `validate` to gate a `macos-native` job for full changes, and require docs to state Launch Services supervision, one permission identity, and no direct-executable fallback:

```javascript
assert.deepEqual(
  validateCiResults({
    route: "full",
    static: "success",
    docs: "success",
    unit: "success",
    browser: "success",
    macosNative: "success",
  }),
  { ok: true, errors: [] },
);
assert.equal(
  validateCiResults({
    route: "full",
    static: "success",
    docs: "success",
    unit: "success",
    browser: "success",
    macosNative: "failure",
  }).ok,
  false,
);
```

Also require `macosNative: "skipped"` for the docs-only route and extend the `runCiPolicy(["gate", ...])` contract to accept the sixth job result after `route`.

```typescript
expect(guide).toContain("Launch Services");
expect(guide).toContain("Auto Demo Capture.app");
expect(guide).toContain("capture_helper_permission_required");
expect(guide).toContain("supervisor");
expect(guide).not.toContain("grant Screen Recording to Terminal");
```

- [ ] **Step 2: Run tests and verify RED**

```bash
rtk node --test scripts/ci-policy.test.mjs
rtk npm --workspace @auto-demo/cli exec vitest -- run src/packaging-docs.test.ts
```

Expected: FAIL because the gate has no macOS-native result and the published docs do not describe supervision.

- [ ] **Step 3: Add the focused macOS job and aggregate gate**

Add this job, adapted only for repository naming:

```yaml
macos-native:
  needs: changes
  if: needs.changes.outputs.route == 'full'
  runs-on: macos-latest
  steps:
    - name: Checkout
      uses: actions/checkout@v7
    - name: Test native capture helper
      run: swift test --package-path native/macos-capture-helper
    - name: Build native capture helper
      run: swift build --package-path native/macos-capture-helper --configuration release
    - name: Assemble ad-hoc test bundle
      shell: bash
      run: |
        set -euo pipefail
        APP="$RUNNER_TEMP/Auto Demo Capture.app"
        mkdir -p "$APP/Contents/MacOS"
        cp native/macos-capture-helper/Info.plist "$APP/Contents/Info.plist"
        cp native/macos-capture-helper/.build/release/AutoDemoCaptureHelper "$APP/Contents/MacOS/"
        cp native/macos-capture-helper/.build/release/AutoDemoCaptureSupervisor "$APP/Contents/MacOS/"
        codesign --force --sign - --identifier com.autodemo.capture-helper "$APP"
        codesign --verify --deep --strict "$APP"
        test -x "$APP/Contents/MacOS/AutoDemoCaptureHelper"
        test -x "$APP/Contents/MacOS/AutoDemoCaptureSupervisor"
        test "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" = "com.autodemo.capture-helper"
```

This job intentionally stops at Swift tests, a release build, bundle assembly, executable checks, bundle-identifier verification, and ad-hoc signature verification. It must never launch the app, request Screen Recording, or infer TCC state in CI. Add `macos-native` to `validate.needs` and pass its result into the gate; require the job to succeed for full changes and to be skipped for docs-only changes.

- [ ] **Step 4: Update public docs and WES-273 lifecycle documents**

Document that setup and runtime launch the signed app through its bundled supervisor, permission belongs only to `com.autodemo.capture-helper`, normal close terminates the exact app instance, and the idle timeout is an orphan backstop. Link the approved supervision spec and this plan from the WES-273 acceptance documents and add the discovered Task 3 correction before the unchecked acceptance phase.

- [ ] **Step 5: Run CI policy, docs, and formatting checks**

```bash
rtk node --test scripts/ci-policy.test.mjs scripts/ci-test-partitions.test.mjs
rtk npm --workspace @auto-demo/cli exec vitest -- run src/packaging-docs.test.ts
rtk npm exec prettier -- --check .github/workflows/ci.yml scripts/ci-policy.mjs scripts/ci-policy.test.mjs docs/guides/screenshot-coordinate-discovery.md packages/cli/README.md packages/cli/src/packaging-docs.test.ts docs/superpowers/specs/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-design.md docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md docs/superpowers/specs/2026-07-21-wes-273-macos-capture-helper-supervision-design.md docs/superpowers/plans/2026-07-21-wes-273-macos-capture-helper-supervision.md
rtk git diff --check
```

Expected: CI policy, docs contracts, formatting, and diff checks pass.

- [ ] **Step 6: Commit CI and documentation**

```bash
rtk git add .github/workflows/ci.yml scripts/ci-policy.mjs scripts/ci-policy.test.mjs docs/guides/screenshot-coordinate-discovery.md packages/cli/README.md packages/cli/src/packaging-docs.test.ts docs/superpowers/specs/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-design.md docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md docs/superpowers/specs/2026-07-21-wes-273-macos-capture-helper-supervision-design.md docs/superpowers/plans/2026-07-21-wes-273-macos-capture-helper-supervision.md docs/linear/auto-demo-project-structure.md
rtk git commit -m "WES-273: gate native capture supervision"
```

### Task 7: Prove The Real Local macOS Capability

**Files:**

- Create locally, do not commit: owner-only helper probe/capture artifacts under a temporary directory
- Modify after evidence is verified: `docs/linear/auto-demo-project-structure.md`
- Modify after evidence is verified: `docs/superpowers/plans/2026-07-21-wes-273-macos-capture-helper-supervision.md`

- [ ] **Step 1: Run focused and complete implementation verification**

```bash
rtk swift test --package-path native/macos-capture-helper
rtk npm --workspace @auto-demo/agent exec vitest -- run src/macOsCaptureHelperClient.test.ts src/macOsBrowserWindowCapture.test.ts
rtk npm --workspace @auto-demo/cli exec vitest -- run src/macosCaptureHelperSetup.test.ts src/playwrightDiscoverRuntime.test.ts src/packaging-docs.test.ts
rtk npm run build
rtk npm run typecheck:ci
rtk npm run test:ci
rtk npm run lint
rtk npm run format:check
rtk git diff --check
```

Expected: all Swift, focused helper, repository build, typecheck, test, lint, formatting, and diff gates pass. Preserved unrelated `workflow/` diagnostics may still make repository-wide lint noisy only if they retain their pre-existing findings; verify issue-owned paths separately and rely on clean-checkout CI for the repository-wide gate in that case.

- [ ] **Step 2: Install and preflight the real signed app**

```bash
rtk npm run autodemo -- setup capture-helper --json
```

Expected: `ok: true`, `code: capture_helper_ready`, development signature, and install path `~/Applications/Auto Demo Capture.app`. If rebuilding invalidates the existing grant, stop for one user authorization of that same app identity, then rerun this exact command.

- [ ] **Step 3: Run the real local capture lifecycle check**

Run the repository-owned local-only test through the package's regular Vitest surface:

```bash
AUTODEMO_REAL_CAPTURE_HELPER=1 rtk npm --workspace @auto-demo/agent exec vitest -- run src/macOsCaptureHelperClient.local.test.ts
```

The test uses the public helper client to capture one 32-by-32 region into an owner-only temporary directory, validates the PNG signature and exact dimensions, closes the client, and verifies cleanup. If a concise machine-readable result is emitted, it may contain only:

```json
{
  "ok": true,
  "code": "capture_helper_local_check_passed",
  "protocolVersion": 1,
  "cleanup": "passed"
}
```

It must not print, commit, upload, or retain image bytes, signing identity, Team ID, tokens, private paths, or screen content.

- [ ] **Step 4: Verify shutdown and cleanup independently**

```bash
rtk npm run autodemo -- setup capture-helper --json
ps aux | rtk rg 'AutoDemoCaptureHelper|AutoDemoCaptureSupervisor'
```

Expected: setup remains ready; no supervisor/helper process remains; the local check reports no bootstrap, response, or socket artifacts after close.

- [ ] **Step 5: Record bounded capability evidence and commit**

Record only commands, pass/fail status, protocol version, development/ad-hoc category, exact PNG dimensions, and cleanup pass. Then:

```bash
rtk git add docs/linear/auto-demo-project-structure.md docs/superpowers/plans/2026-07-21-wes-273-macos-capture-helper-supervision.md
rtk git commit -m "WES-273: verify supervised macOS capture"
```

Current result: PASS on 2026-07-21. The development-signed app returned
`capture_helper_ready`; the real-helper test captured and parsed an exact
32-by-32 PNG, removed its private session artifacts, and confirmed no helper or
supervisor process remained. A repeat setup preflight stayed ready. The first
independent process check exposed an equal-timeout shutdown race; the final
RED-GREEN correction uses a one-second supervisor grace period, a five-second
Node allowance, and exact-PID termination observation. The final local lifecycle
completed inside the five-second test deadline with no retained image data or
private launch material.

### Task 8: Run Fresh Prompt-Only Cars.com Acceptance To Review

Acceptance correction result: the first warned rerun did not reach review. Two
autonomous discovery sessions encountered intermittent
`native_window_capture_unavailable` while reopening the Cars.com native
distance menu, and the agent exceeded the single permitted clean retry. The run
was stopped without replay, approval, recording, handoff, editor, or export.
RED-GREEN correction now refreshes geometry for every native capture and
retains owner-only, sanitized stage diagnostics spanning helper lifecycle,
ScreenCaptureKit, display selection, transport, response validation, and PNG
normalization. The signed real-helper gate passes with a retained diagnostic
file and no helper or supervisor process left running. Restart this task only
from a new reviewed commit and a new clean clone.

The next clean reviewed run made the failure causal: four native captures
succeeded before an immediate `capture_socket_error`, and the single clean
retry again succeeded before the same transport failure. Retained artifact
times showed 52- and 75-second reasoning gaps after the preceding frames, both
longer than the hard 30-second helper idle limit. The helper had exited and
removed its socket while the owning discovery host was still active. RED-GREEN
correction raises the validated orphan backstop to five minutes and adds bounded
session-relative elapsed time to every diagnostic record. This is a generic
session-lifecycle correction, not Cars.com-specific recovery guidance.

The reviewed five-minute build then completed every native capture and closed
both helpers cleanly, but the prompt-only acceptance still did not reach review.
The initial discovery and its one clean retry independently selected New, Kia,
Sorento, and All miles. Each Show matches command returned only
`discover_host_failed`; a later observation retained the same public hard-block
page, while the failing click itself never entered the trace. No HTTP status,
origin relation, structured challenge classification, or internal failure stage
was retained, and both host logs were empty. The second session was a retry, not
replay validation. Add generic bounded discovery-host diagnostics before any
new acceptance; do not infer a server-side classification reason or add a
Cars.com-specific workaround.

#### Step group A: Retain bounded discovery-host navigation diagnostics

**Files:**

- Create: `packages/cli/src/discoverHostDiagnostics.ts`
- Create: `packages/cli/src/discoverHostDiagnostics.test.ts`
- Modify: `packages/agent/src/coordinateDiscoverySession.ts`
- Modify: `packages/agent/src/coordinateDiscoverySession.test.ts`
- Modify: `packages/cli/src/playwrightDiscoverRuntime.ts`
- Modify: `packages/cli/package.json`
- Modify: `docs/guides/screenshot-coordinate-discovery.md`
- Modify: `packages/cli/README.md`

- [x] **Step 1: Write failing recorder and page-boundary tests**

Add behavior tests that require a `0600` `discover-host-diagnostics.jsonl` with
ordered sequence numbers and bounded `sessionElapsedMs`. Drive a fake page with
one ignored subresource response and main-document responses on the starting
and another origin. Require only bounded response status/origin relation and the
resolved profile projection to persist. Seed raw URL paths, headers, bodies,
page text, target labels, coordinates, tokens, socket paths, and exception text,
then require every seeded value to be absent.

Run:

```bash
rtk npm --workspace @auto-demo/cli exec vitest run src/discoverHostDiagnostics.test.ts
```

Expected: FAIL because the bounded recorder and page diagnostic attachment do
not exist.

- [x] **Step 2: Write the failing exact-stage test**

Extend the coordinate-session fake so `state()` throws a secret-bearing error
only after a click begins navigation. Supply an in-memory diagnostic sink and
require the action to retain a stable `after_action_state` failure with action
index/type while excluding the raw error. Preserve the existing public failure
behavior.

Run:

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/coordinateDiscoverySession.test.ts
```

Expected: FAIL because coordinate discovery has no diagnostic sink or stable
action-stage events.

- [x] **Step 3: Implement the minimal private recorder and page diagnostics**

Create a best-effort ordered recorder that opens exactly one new `0600` JSONL
file, clamps session elapsed time to 24 hours, and suppresses diagnostic write
and close failures. Attach to Playwright main-document responses only; persist
status `100...599` and `same-origin` or `other-origin`, never the response URL or
headers. Record the selected channel/headless/viewport profile and hashed public
profile ID when the runtime starts.

- [x] **Step 4: Add exact coordinate-action stage diagnostics**

Add an optional diagnostic sink to `createCoordinateDiscoverySession`. Wrap
challenge checks, current/before/after page-state reads, target inspection,
action execution, and boundary capture with stable stage attribution. Persist
only failures plus one bounded action outcome; never pass exception objects or
raw messages to the sink. Await diagnostics best-effort so they are ordered but
cannot alter action behavior.

- [x] **Step 5: Integrate lifecycle ownership and verify GREEN**

The Playwright discover runtime owns the recorder, records runtime start/action
outcome/unexpected runtime failure/stop, detaches page listeners, and closes the
recorder in every startup failure and normal/abandoned shutdown path. Existing
browser and capture cleanup remains authoritative.

Run:

```bash
rtk npm --workspace @auto-demo/agent exec vitest run src/coordinateDiscoverySession.test.ts
rtk npm --workspace @auto-demo/cli exec vitest run src/discoverHostDiagnostics.test.ts src/playwrightDiscoverRuntime.test.ts
rtk npm --workspace @auto-demo/agent run typecheck
rtk npm --workspace @auto-demo/cli run typecheck
rtk git diff --check
```

Expected: all focused tests, both package typechecks, and diff validation pass.

- [ ] **Step 6: Document, verify broadly, commit, and review**

Document the owner-only file, stable fields, forbidden content, and diagnostic-
only purpose. Run the complete agent and CLI suites, repository build/test CI,
Prettier/ESLint on issue-owned files, and diff validation. Commit only WES-273
paths as `WES-273: diagnose discovery host failures`, then obtain independent
read-only review before creating another clean acceptance clone.

#### Step group B: Run fresh prompt-only acceptance at the reviewed diagnostic head

**Files:**

- Create locally, do not commit: a new clean acceptance checkout and `workflow/` session artifacts
- Modify after verified result: `docs/linear/auto-demo-project-structure.md`
- Modify after verified result: `docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md`

- [ ] **Step 1: Create and verify a clean checkout at the reviewed branch head**

Create a new temporary clone from the current committed branch head. Verify `git status --short` is empty, the clone includes the supervision commits, dependencies/build/browser setup pass, and no current-checkout `workflow/` artifacts are present.

- [ ] **Step 2: Dispatch a context-isolated Codex acceptance agent**

Give the fresh agent no forked conversation and exactly this task:

```text
Read and follow packages/agent/skills/codex-auto-demo/SKILL.md.

Use YOLO autonomous discovery for this public-site browsing flow on https://www.cars.com/.

Goal: Search nationwide for new Kia Sorento vehicles, then open the first vehicle listing shown in the results.

Requirements:
- Set condition to New.
- Set make to Kia.
- Set model to Sorento.
- Set distance to Nationwide or All miles. If the site requires a ZIP code and none is available, pause and ask me for one.
- Do not select sponsored inventory over organic inventory unless it is genuinely the first vehicle listing in the normal results order.
- Click only the first actual vehicle listing; do not contact a dealer, reveal a phone number, save/favorite a vehicle, request financing, or submit any form.
- Treat cookie banners and ordinary navigation as safe interactions.
- Move the visible mouse pointer to controls before clicking or focusing them. For native dropdowns, pointer-focus the control and choose the exact public option label with keyboard input. Do not loop on the same target after repeated no-effect actions.
- Use the normal headed browser default. Do not choose a headless profile unless I directly request headless operation.
- Use YOLO mode for discovery and replay, and freshly select YOLO again for recording only after explicit approval. Keep browser actions on Cars.com. Do not enter credentials or payment data, download anything, contact a dealer, reveal a phone number, save/favorite a vehicle, request financing, or submit a form.
- Compile the discovered path, replay it in a fresh browser, and repair stale targets if necessary.
- Present the sanitized, replay-validated walkthrough to me for explicit approval before recording.
- After I approve it, record the walkthrough and create the Auto Demo project at ./demos/cars-kia-sorento.
- Do not open the editor or export an MP4 unless I request it afterward.

Pass criteria:
- Run in a fresh agent session with no hidden operator guidance.
- The first phase passes only when the agent reaches the sanitized replay-validated walkthrough and requests explicit approval.
- After explicit approval, recording and project handoff complete at ./demos/cars-kia-sorento.
- The editor and MP4 export remain unopened.
- Site-caused transient failure may trigger a clean rerun, but hidden context invalidates the pass.
```

- [ ] **Step 3: Evaluate phase-one result without coaching**

Pass only if the fresh agent independently reaches `review_required` with a blocker-free replay-validated plan covering New, Kia, Sorento, Nationwide/All miles, and the first eligible listing. One clean identical-prompt rerun is allowed only for a bounded site-caused transient failure. A request for selectors, browser-profile advice, policy exceptions, Cloudflare workarounds, or other Cars.com guidance fails acceptance.

- [ ] **Step 4: Present the complete sanitized review and stop**

Present every ordered public step, assumption, warning, question, and blocker to the user. Ask whether the user explicitly approves that exact walkthrough. Do not run approval, recording, or handoff until the user answers affirmatively.

### Task 9: Record After Approval And Publish Completion Evidence

**Files:**

- Create locally, do not commit: `demos/cars-kia-sorento/**`, execution result, and capture artifacts
- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: `docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md`
- Modify: `docs/superpowers/plans/2026-07-21-wes-273-macos-capture-helper-supervision.md`

- [ ] **Step 1: Persist explicit approval through the supported contract**

After the user approves, have the same isolated agent invoke the repository approval command/API and persist the returned approved artifact. Conversation text or a boolean is not approval evidence.

- [ ] **Step 2: Freshly establish YOLO and record**

The isolated agent starts a fresh recording context with the approved launch profile and YOLO freshly established, executes the approved walkthrough, and hands off to `./demos/cars-kia-sorento`. No editor or export process may start.

- [ ] **Step 3: Verify the generated project through public commands**

```bash
rtk npm run autodemo -- validate ./demos/cars-kia-sorento
rtk npm run autodemo -- agent run --project ./demos/cars-kia-sorento --json
```

Expected: validation succeeds and agent handoff selects a valid saved variant without opening the editor.

- [ ] **Step 4: Update stable evidence and close plan checkboxes**

Record the reviewed branch commit, fresh-agent boundary, exact prompt, replay validation, user approval, recording, handoff, public project validation, editor/export prohibition, and preserved unrelated paths. Mark completed steps in both WES-273 plans; explicitly disposition superseded or defect-only steps.

- [ ] **Step 5: Request independent read-only review**

Give the reviewer WES-273, both approved specs, both active plans, the diff, local helper evidence, exact acceptance prompt, sanitized review, approval evidence, project-validation commands, and preserved unrelated paths. Require Critical/Important/Minor findings and Ready/Not Ready. Verify every finding before changing code.

- [ ] **Step 6: Run affected checks after review fixes and commit evidence**

Run focused checks for every material fix. If only docs change, run docs contracts, Prettier on changed docs, and `git diff --check`. Commit only issue-owned paths:

```bash
rtk git add docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-design.md docs/superpowers/specs/2026-07-21-wes-273-macos-capture-helper-supervision-design.md docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md docs/superpowers/plans/2026-07-21-wes-273-macos-capture-helper-supervision.md
rtk git commit -m "WES-273: record supervised Cars.com acceptance"
```

### Task 10: Publish, Merge, And Synchronize WES-273

**Files:**

- Modify if final evidence requires it: `docs/linear/auto-demo-project-structure.md`
- Modify if final evidence requires it: both active WES-273 plan documents

- [ ] **Step 1: Verify before publication**

Run the complete relevant local suite once on the final implementation, verify both active plans for unchecked in-scope items, inspect the full diff, and confirm `.gitignore`, `.codex/`, `.lavish/`, `workflow/`, generated demo, and acceptance-clone artifacts remain unstaged.

- [ ] **Step 2: Push and open the WES-273 PR**

Push `wes-273-launchservices-capture-helper` and open a squash PR to `develop`. Include WES-273, both design/plan paths, the root cause, RED-GREEN evidence, local signed-helper gate, exact Cars.com acceptance, approval/recording/handoff evidence, independent review, and exact verification commands.

- [ ] **Step 3: Monitor checks and reviews**

Require Ubuntu static/docs/unit/browser/validate plus the new macOS-native job to pass on the exact PR head. Diagnose failures before changing code, triage all review threads, fix only verified in-scope findings, rerun affected checks, and keep all actionable threads resolved before merge.

- [ ] **Step 4: Squash merge and synchronize local `develop`**

After all checks and findings are clear, squash merge. Verify `origin` owns the PR base, switch to `develop`, fetch `origin/develop`, and run:

```bash
rtk git pull --ff-only origin develop
```

Expected: local `develop` contains the squash commit and preserved unrelated paths remain intact.

- [ ] **Step 5: Run the completion sync gate**

Validate the merged PR, squash commit, exact-head CI, specs, plans, local helper evidence, fresh Cars.com acceptance, user approval, recording/handoff, and project map. Add WES-273 completion evidence and move WES-273 to Done. Keep WES-275 Backlog and unstarted; make it the deterministic next issue. Keep WES-265 Backlog until its WES-275 child/completion semantics are reconciled or WES-275 completes.

- [ ] **Step 6: Publish a scoped completion-sync PR if required**

If the completion gate requires tracked map/plan corrections, create `wes-273-completion-sync`, commit only those files, open a PR to `develop`, wait for all required checks, squash merge, and fast-forward local `develop` again. Never push directly to `develop`.

- [ ] **Step 7: Confirm no unfinished in-scope plan items**

```bash
rtk rg -n '^\s*[-*]\s+\[ \]' docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md docs/superpowers/plans/2026-07-21-wes-273-macos-capture-helper-supervision.md
```

Expected: no unchecked in-scope WES-273 item remains; WES-275 work is explicitly deferred and was not started.
