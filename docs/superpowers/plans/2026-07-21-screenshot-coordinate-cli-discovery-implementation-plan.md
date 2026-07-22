# Screenshot-Coordinate CLI Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slow host-authored discovery decision loop with a provider-neutral CLI in which a vision-capable agent reads local screenshots and drives a persistent headed browser through bounded coordinate actions that compile into semantic replay.

**Architecture:** Add a small shared `@auto-demo/browser-input` workspace package so discovery, replay, and recording use one deterministic natural-input driver. The agent package will own the coordinate protocol, screenshot/private-evidence adapter, durable session engine, and finalization into the existing discovery compiler and replay/review pipeline; the CLI package will own a detached local host and bounded Unix-socket client commands so each CLI invocation can reconnect without relaunching the browser. Raw coordinates and runtime input text remain discovery-time data only, while durable artifacts contain public semantic targets, structural intent, exact public option labels, frame metadata, and sanitized diagnostics.

**Tech Stack:** TypeScript, Node.js, Playwright, Vitest, PNGJS, Unix-domain sockets, existing Auto Demo discovery/compiler/replay/review contracts, Linear CLI.

---

## File Structure

- Create `packages/browser-input/package.json`, `packages/browser-input/tsconfig.json`, `packages/browser-input/src/index.ts`, and `packages/browser-input/src/naturalInputDriver.test.ts` for the shared deterministic pointer, wheel, and keyboard boundary.
- Modify `packages/agent/package.json`, `packages/capture/package.json`, `packages/cli/package.json`, and `package-lock.json` to declare the new workspace dependency, PNG composition dependency, and clean build ordering.
- Create `packages/agent/src/coordinateDiscoveryContract.ts` and `packages/agent/src/coordinateDiscoveryContract.test.ts` for provider-neutral JSON inputs, outputs, limits, and validation.
- Create `packages/agent/src/playwrightCoordinateDiscoveryPage.ts` and `packages/agent/src/playwrightCoordinateDiscoveryPage.test.ts` for frame capture, cursor overlay, coordinate hit testing, public form snapshots, layout identity, native-window capture, and physical input.
- Create `packages/agent/src/coordinateDiscoverySession.ts` and `packages/agent/src/coordinateDiscoverySession.test.ts` for frame validity, bounded batches, action-to-semantic mapping, transient input bindings, and terminal lifecycle behavior.
- Create `packages/agent/src/coordinateDiscoveryStore.ts` and `packages/agent/src/coordinateDiscoveryStore.test.ts` for atomic checkpoints, PNGs, private traces, recovery metadata, and cleanup-safe session directories.
- Create `packages/agent/src/coordinateDiscoveryFinalize.ts` and `packages/agent/src/coordinateDiscoveryFinalize.test.ts` for selected-path completion, compilation, fresh semantic replay, repair handoff, and sanitized review output.
- Modify `packages/agent/src/playwrightPointerActions.ts`, `packages/agent/src/playwrightDiscoveryPage.ts`, `packages/agent/src/playwrightDiscoveryReplay.ts`, and their behavior tests to route replay and existing discovery through the shared natural-input driver without DOM click/fill/select shortcuts.
- Modify `packages/capture/src/playwrightPointerActions.ts`, `packages/capture/src/playwrightAdapter.ts`, and their behavior tests so approved recording uses the same shared driver.
- Create `packages/cli/src/discoverProtocol.ts`, `packages/cli/src/discoverHost.ts`, `packages/cli/src/discoverCommand.ts`, and matching tests for the detached host, authenticated local socket, CLI parsing, and JSON rendering.
- Modify `packages/cli/src/index.ts`, `packages/cli/src/index.test.ts`, `packages/cli/src/agenticDiscoveryAcceptance.test.ts`, `packages/agent/src/index.ts`, and package test scripts to publish and exercise the new boundary.
- Create `docs/guides/screenshot-coordinate-discovery.md`; modify `README.md`, `packages/agent/skills/codex-auto-demo/SKILL.md`, `docs/linear/auto-demo-project-structure.md`, and this plan with public usage and acceptance evidence.

### Task 1: Add The Shared Deterministic Natural-Input Driver

**Files:**

- Create: `packages/browser-input/package.json`
- Create: `packages/browser-input/tsconfig.json`
- Create: `packages/browser-input/src/index.ts`
- Test: `packages/browser-input/src/naturalInputDriver.test.ts`
- Modify: `packages/agent/package.json`
- Modify: `packages/capture/package.json`
- Modify: `packages/cli/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing black-box trajectory and physical-input tests**

Create tests around a fake Playwright-shaped input port. Assert observable emitted events: equal inputs produce equal paths; short and long moves have different bounded durations; every non-zero move has intermediate points and finishes exactly at the destination; speed eases at both ends; click emits move, settle, down, and up; double-click emits two physical down/up pairs; scroll moves before wheel; keyboard actions preserve order.

```ts
const driver = createNaturalInputDriver(fakeInput(events), {
  pointer: { x: 20, y: 30 },
  settleMs: 40,
});
await driver.click({ x: 420, y: 245 });

expect(events.at(-3)).toEqual({ kind: "wait", durationMs: 40 });
expect(events.slice(-2)).toEqual([
  { kind: "down", button: "left" },
  { kind: "up", button: "left" },
]);
expect(driver.pointer()).toEqual({ x: 420, y: 245 });
expect(events.filter((event) => event.kind === "move").length).toBeGreaterThan(2);
```

- [ ] **Step 2: Run the new package test to verify RED**

Run:

```bash
rtk npm test --workspace @auto-demo/browser-input
```

Expected: FAIL because `createNaturalInputDriver` and the new workspace package do not exist.

- [ ] **Step 3: Implement the minimal public driver**

Expose this provider-independent contract from `packages/browser-input/src/index.ts`:

```ts
export type ScreenPoint = { x: number; y: number };
export type NaturalInputPort = {
  move(point: ScreenPoint): Promise<void>;
  down(button: "left"): Promise<void>;
  up(button: "left"): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
  keypress(key: string): Promise<void>;
  type(text: string): Promise<void>;
  wait(durationMs: number): Promise<void>;
};
export type NaturalInputDriver = {
  pointer(): ScreenPoint;
  move(destination: ScreenPoint): Promise<void>;
  click(destination: ScreenPoint): Promise<void>;
  doubleClick(destination: ScreenPoint): Promise<void>;
  scroll(destination: ScreenPoint, deltaX: number, deltaY: number): Promise<void>;
  keypress(keys: string[]): Promise<void>;
  type(text: string): Promise<void>;
};
```

Generate a deterministic cubic Bezier trajectory from the current pointer to the destination. Derive step count and duration only from Euclidean distance, use `t * t * (3 - 2 * t)` easing, emit every intermediate point through the port, wait `settleMs` after reaching a click/scroll destination, and never add random jitter. Validate finite coordinates at this boundary instead of clamping them.

- [ ] **Step 4: Wire workspace dependency and clean-build order**

Add `@auto-demo/browser-input: "0.0.0"` to agent and capture dependencies. Add `npm run build -w @auto-demo/browser-input` to their `prebuild` and `pretypecheck` scripts, and ensure CLI prebuild/typecheck builds capture as well as agent. Generate `package-lock.json` mechanically:

```bash
rtk npm install --package-lock-only
```

Expected: the lockfile contains the local workspace package and no registry-published Auto Demo package.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
rtk npm test --workspace @auto-demo/browser-input
rtk npm run typecheck --workspace @auto-demo/browser-input
rtk npm run build --workspace @auto-demo/browser-input
rtk git diff --check
```

Expected: all commands pass from a clean generated-artifact state.

Commit only Task 1 paths:

```bash
rtk git add packages/browser-input packages/agent/package.json packages/capture/package.json packages/cli/package.json package-lock.json
rtk git commit -m "WES-273: add deterministic natural browser input"
```

### Task 2: Define And Validate The Provider-Neutral Coordinate Protocol

**Files:**

- Create: `packages/agent/src/coordinateDiscoveryContract.ts`
- Test: `packages/agent/src/coordinateDiscoveryContract.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing protocol behavior tests**

Test valid action files and bounded failures through `parseCoordinateActionBatch`. Cover all seven actions, a maximum of 16 actions, finite integer coordinates, viewport bounds, wheel limits, wait limits, key allow-list, type length, unknown fields, stale/unsafe frame IDs, and the guarantee that invalid batches return no executable actions.

```ts
expect(
  parseCoordinateActionBatch(
    {
      frameId: "frame-1",
      actions: [
        { type: "click", x: 420, y: 245 },
        { type: "keypress", keys: ["N", "ENTER"] },
      ],
    },
    { width: 1280, height: 720 },
  ),
).toEqual({
  ok: true,
  batch: {
    frameId: "frame-1",
    actions: [
      { type: "click", x: 420, y: 245 },
      { type: "keypress", keys: ["N", "ENTER"] },
    ],
  },
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/coordinateDiscoveryContract.test.ts
```

Expected: FAIL because the protocol module is missing.

- [ ] **Step 3: Implement exact protocol types and bounded errors**

Define the public union exactly as follows:

```ts
export type CoordinateDiscoveryAction =
  | { type: "move"; x: number; y: number }
  | { type: "click"; x: number; y: number }
  | { type: "double-click"; x: number; y: number }
  | { type: "scroll"; x: number; y: number; deltaX?: number; deltaY: number }
  | { type: "keypress"; keys: string[] }
  | { type: "type"; text: string; binding?: string }
  | { type: "wait"; durationMs: number };

export type CoordinateFrame = {
  id: string;
  screenshotPath: string;
  width: number;
  height: number;
  deviceScaleFactor: 1;
  pointer: { x: number; y: number };
};
```

Return errors with a stable `code`, bounded public `message`, and optional zero-based `actionIndex`. Permit named keyboard keys `ENTER`, `ESCAPE`, `TAB`, `ARROWDOWN`, `ARROWUP`, `PAGEUP`, `PAGEDOWN`, `HOME`, `END`, `SPACE`, `BACKSPACE`, `DELETE`, plus a single printable Unicode character. Do not include input text in any error.

- [ ] **Step 4: Export the contract and add it to package tests**

Export only provider-neutral types, parsers, limits, and error codes from `packages/agent/src/index.ts`. Add the test file to agent `test` and `test:unit` scripts.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/coordinateDiscoveryContract.test.ts
rtk npm run typecheck --workspace @auto-demo/agent
rtk git diff --check
```

Expected: focused tests and typecheck pass.

```bash
rtk git add packages/agent/src/coordinateDiscoveryContract.ts packages/agent/src/coordinateDiscoveryContract.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "WES-273: define screenshot coordinate protocol"
```

### Task 3: Capture Cursor-Annotated Frames And Private Coordinate Evidence

**Files:**

- Create: `packages/agent/src/playwrightCoordinateDiscoveryPage.ts`
- Test: `packages/agent/src/playwrightCoordinateDiscoveryPage.test.ts`
- Modify: `packages/agent/package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Write failing browser-boundary tests**

Use a local HTML fixture and real Playwright page to verify that an observation PNG has exact viewport dimensions and a cursor overlay at the persisted point while a simultaneous DOM inspection confirms no overlay node/style was inserted. Verify `elementFromPoint` maps a coordinate to public role/label/occurrence, form state, exact selected option, credential/payment/upload risk, and repeated-list structural position. Verify layout identity changes after scrolling, navigation, viewport resize, popup opening, and meaningful target movement. Verify native UI requests call the injected window-capture adapter and fail with `native_window_capture_unavailable` when it cannot produce an exact browser-window PNG.

```ts
const frame = await adapter.captureFrame({
  id: "frame-1",
  pointer: { x: 64, y: 64 },
  grid: false,
});
expect(frame).toMatchObject({ width: 1280, height: 720, deviceScaleFactor: 1 });
expect(await page.locator("[data-autodemo-cursor]").count()).toBe(0);
expect(readPixel(frame.png, 64, 64)).not.toEqual(readPixel(rawScreenshot, 64, 64));
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/playwrightCoordinateDiscoveryPage.test.ts
```

Expected: FAIL because the adapter is missing.

- [ ] **Step 3: Implement screenshot composition outside the page**

Add `pngjs` to agent dependencies and `@types/pngjs` to dev dependencies. Decode `page.screenshot({ type: "png", animations: "disabled" })`, paint a small high-contrast cursor and optional 100-pixel diagnostic grid into a copied PNG buffer, then write only the composed bytes. Do not mutate page DOM, browser CSS, or final recording frames.

- [ ] **Step 4: Implement private hit testing and state snapshots**

Expose an agent-internal adapter with this boundary:

```ts
export type CoordinateTargetEvidence = {
  identityKey: string;
  target: DiscoveryInteractiveTarget;
  risk: DiscoveryTargetRuntimeRisk;
  formBefore?: DiscoveryFormState;
  structure?: DiscoveryTargetStructure;
};

export interface CoordinateDiscoveryPage {
  captureFrame(input: { id: string; pointer: ScreenPoint; grid: boolean }): Promise<CapturedFrame>;
  inspectPoint(point: ScreenPoint): Promise<CoordinateTargetEvidence | undefined>;
  snapshotPublicState(): Promise<CoordinatePublicState>;
  layoutIdentity(): Promise<string>;
  nativeUiState(): Promise<"closed" | "open">;
  execute(action: CoordinateDiscoveryAction): Promise<void>;
  close(): Promise<void>;
}
```

Reuse the existing observation label, occurrence, promotion exclusion, and form-state rules rather than creating coordinate-only semantic rules. Hash only bounded public/layout facts for `layoutIdentity`; never hash input values.

- [ ] **Step 5: Add exact native browser-window capture behavior**

Superseded by the approved [on-demand macOS capture-helper plan](2026-07-21-on-demand-macos-capture-helper.md). Headed macOS discovery uses the locally signed `Auto Demo Capture.app`, ScreenCaptureKit, and an authenticated same-user Unix socket. `discover start` preflights installation, signature, protocol, and permission before opening the browser; native UI never falls back to a page-only PNG. Other platforms use an injected adapter or a bounded capability error.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
rtk npm install --package-lock-only
rtk npm test --workspace @auto-demo/agent -- --run src/playwrightCoordinateDiscoveryPage.test.ts
rtk npm run typecheck --workspace @auto-demo/agent
rtk git diff --check
```

Expected: frame, privacy, semantic evidence, native capability, and type checks pass.

```bash
rtk git add packages/agent/src/playwrightCoordinateDiscoveryPage.ts packages/agent/src/playwrightCoordinateDiscoveryPage.test.ts packages/agent/package.json package-lock.json
rtk git commit -m "WES-273: capture coordinate discovery frames"
```

### Task 4: Execute Bounded Action Batches Against Valid Coordinate Frames

**Files:**

- Create: `packages/agent/src/coordinateDiscoverySession.ts`
- Test: `packages/agent/src/coordinateDiscoverySession.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing session behavior tests**

Build tests around a fake `CoordinateDiscoveryPage`. Cover:

- one unchanged frame executing multiple actions in order;
- stale frame, malformed batch, and out-of-bounds input executing nothing;
- click/double-click resolving target evidence before the action;
- location-aware scroll moving to `(x, y)` before wheel input;
- navigation, page scroll, popup opening, viewport change, or layout movement ending the batch before the next action and returning a fresh frame;
- a failed action returning `failedActionIndex` and skipping later actions;
- native-select public state change recording the exact option label;
- type text reaching the live input but never appearing in checkpoint, trace, JSON result, or error;
- challenge/policy evidence stopping the session without workaround;
- finish rejecting any selected action that lacks semantic or structural replay evidence.

```ts
const result = await session.act({
  frameId: "frame-1",
  actions: [
    { type: "click", x: 120, y: 80 },
    { type: "keypress", keys: ["K", "I", "A", "ENTER"] },
    { type: "click", x: 300, y: 80 },
  ],
});
expect(result).toMatchObject({
  ok: true,
  executedActions: 1,
  boundary: "popup_opened",
  frame: { id: "frame-2" },
});
expect(fakePage.executed).toHaveLength(1);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/coordinateDiscoverySession.test.ts
```

Expected: FAIL because the session engine does not exist.

- [ ] **Step 3: Implement the lifecycle and frame state machine**

Implement phases `starting`, `discovering`, `repairing`, `review-required`, `completed`, `abandoned`, and `failed`. A frame is valid only while its document token, scroll position, viewport, popup state, and layout identity equal the capture baseline. Validate the entire batch before any execution. After every accepted action, persist pointer position, private semantic evidence, public before/after effects, and a transient input-binding reference.

- [ ] **Step 4: Map coordinate actions into the existing discovery contract**

For click and double-click, create semantic click attempts using the public target ID assigned to the private `identityKey`; double-click produces one replay click only when one click caused the observed public effect, otherwise reject it as unmappable. Convert native selection changes to `{ kind: "select", targetId, optionLabel }`. Convert typed input to `{ kind: "type", targetId, inputBinding, valueClass: "demo-data" }` while keeping the binding value only in host memory. Convert waits to existing wait attempts. Treat pure move, scroll, and keypress as discovery-only mechanics unless their before/after public evidence maps them to a select, navigation, click, or assertion; otherwise omit no-effect mechanics and block state-changing unmappable mechanics.

- [ ] **Step 5: Implement observation boundaries and errors**

Return a new frame immediately after any state-changing boundary. Invalid/stale batches return `executedActions: 0`. A mid-batch failure returns the original zero-based index, bounded code, current status, and a fresh frame when capture remains safe. Never include the agent-hidden target inventory in any public result.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/coordinateDiscoveryContract.test.ts src/coordinateDiscoverySession.test.ts
rtk npm run typecheck --workspace @auto-demo/agent
rtk git diff --check
```

Expected: all session behavior passes.

```bash
rtk git add packages/agent/src/coordinateDiscoverySession.ts packages/agent/src/coordinateDiscoverySession.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "WES-273: execute coordinate discovery batches"
```

### Task 5: Persist Reconnectable Sessions Without Persisting Runtime Secrets

**Files:**

- Create: `packages/agent/src/coordinateDiscoveryStore.ts`
- Test: `packages/agent/src/coordinateDiscoveryStore.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing atomic-store and recovery tests**

Test initialization only in a missing/empty directory, atomic checkpoint replacement, safe relative frame paths, exact PNG hashes, bounded serialized size, rejection of symlinks/path traversal, recovery after a new client attaches, explicit abandoned cleanup metadata, and recursive scans proving typed text is absent from every durable file.

```ts
await store.writeCheckpoint(checkpointWithTransientBinding("zip", "78701"));
const files = await readAllTextFiles(directory);
expect(files.join("\n")).not.toContain("78701");
expect(await store.loadCheckpoint()).toMatchObject({
  ok: true,
  checkpoint: { transientBindings: ["zip"] },
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/coordinateDiscoveryStore.test.ts
```

Expected: FAIL because the store is missing.

- [ ] **Step 3: Implement the durable layout**

Use this session directory contract:

```text
workflow/<session-id>/
  session.json
  host.json
  frames/frame-<n>.png
  traces/private-trace.json
  sessions/root.json
  sessions/repair-<n>.json
  plan.draft.json
  plan.replay-validated.json
  replay.json
  review.json
  diagnostics.json
```

Write JSON and PNG artifacts to same-directory exclusive temporary files and atomically rename. Persist only binding names/classes, never binding values. Store the socket path, host PID, random authentication-token hash, and heartbeat in `host.json`; store the raw token in a mode-`0600` file excluded from public status output.

- [ ] **Step 4: Export the store and verify GREEN**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/coordinateDiscoveryStore.test.ts
rtk npm run typecheck --workspace @auto-demo/agent
rtk git diff --check
```

Expected: persistence, path safety, privacy, and recovery tests pass.

```bash
rtk git add packages/agent/src/coordinateDiscoveryStore.ts packages/agent/src/coordinateDiscoveryStore.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "WES-273: persist coordinate discovery sessions"
```

### Task 6: Finalize Semantic Plans, Fresh Replay, Repair, And Review

**Files:**

- Create: `packages/agent/src/coordinateDiscoveryFinalize.ts`
- Test: `packages/agent/src/coordinateDiscoveryFinalize.test.ts`
- Modify: `packages/agent/src/index.ts`
- Modify: `packages/agent/package.json`

- [ ] **Step 1: Write failing finalization tests through public artifacts**

Cover a completed coordinate trace compiling to the existing `discovery-v1` plan; exact New/Kia/Sorento/Nationwide option labels; first-organic-result structural target with promotion exclusion; fresh-context replay; blocker-free sanitized review; failed mapping identifying only the bounded action index; replay failure entering `repairing` with a new screenshot; successful repair replacing the stale semantic attempt; and exhaustion after two repairs using the existing bound.

```ts
const result = await finalizeCoordinateDiscovery(session, dependencies);
expect(result).toMatchObject({
  ok: true,
  phase: "review_required",
  plan: { state: "validated", mode: "validate-first" },
  review: { blockers: [] },
});
expect(JSON.stringify(result)).not.toContain('x":420');
expect(JSON.stringify(result)).not.toContain('y":245');
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/coordinateDiscoveryFinalize.test.ts
```

Expected: FAIL because finalization is missing.

- [ ] **Step 3: Implement selected-path completion and compilation**

Before calling `completeDiscoverySession` and `compileDiscoverySessionToWalkthroughPlan`, validate that every state-changing selected coordinate record has a semantic `DiscoveryAction` and matched public evidence. Return `unmappable_coordinate_action` with `actionIndex` for the first gap. Do not add coordinates to `DiscoverySessionV1`, `WalkthroughPlan`, review, execution, or handoff artifacts.

- [ ] **Step 4: Reuse replay and review contracts**

Call `replayAndRepairDiscoveryPlan` with the original policy, launch profile, transient input bindings, and `maxRepairs: 2`. When replay fails, create a child coordinate discovery session using the existing failure evidence and return `phase: "repairing"` plus its first frame. The agent continues through the same `discover act` command and calls `finish` again; a successful child compiles through the existing repair provider and fresh replay. On pass, persist the replay-validated plan and `reviewWalkthroughPlan` result and return `review_required` without approving or recording.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/coordinateDiscoveryFinalize.test.ts src/discoveryPlanCompiler.test.ts src/discoveryReplay.test.ts
rtk npm run typecheck --workspace @auto-demo/agent
rtk git diff --check
```

Expected: finalization, repair bounds, compiler, replay, and privacy checks pass.

```bash
rtk git add packages/agent/src/coordinateDiscoveryFinalize.ts packages/agent/src/coordinateDiscoveryFinalize.test.ts packages/agent/src/index.ts packages/agent/package.json
rtk git commit -m "WES-273: finalize coordinate discovery to review"
```

### Task 7: Add The Persistent Local Host And CLI Lifecycle

**Files:**

- Create: `packages/cli/src/discoverProtocol.ts`
- Create: `packages/cli/src/discoverHost.ts`
- Create: `packages/cli/src/discoverCommand.ts`
- Test: `packages/cli/src/discoverProtocol.test.ts`
- Test: `packages/cli/src/discoverHost.test.ts`
- Test: `packages/cli/src/discoverCommand.test.ts`
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Write failing client/host lifecycle tests**

Test `start`, `observe`, `act`, `status`, `finish`, and `abandon` through the CLI public result. Use an injected in-process host for unit tests and a spawned child for one integration test. Assert that separate CLI calls reuse one browser/session, requests require the private token, request/response bodies are size bounded, a stale/dead host returns `discovery_host_unavailable`, status exposes no token or target inventory, finish pauses at review, and abandon closes the owned browser exactly once while retaining sanitized diagnostics.

```ts
const started = await runCliAsync(
  [
    "discover",
    "start",
    "--url",
    fixtureUrl,
    "--goal",
    "Open the first organic result",
    "--risk",
    "yolo",
    "--json",
  ],
  dependencies,
);
const sessionId = JSON.parse(started.stdout).sessionId;
const observed = await runCliAsync(
  ["discover", "observe", "--session", sessionId, "--json"],
  dependencies,
);
expect(JSON.parse(observed.stdout).frame.id).toBe("frame-1");
expect(dependencies.browserLaunches()).toBe(1);
```

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk npm test --workspace @auto-demo/cli -- --run src/discoverProtocol.test.ts src/discoverHost.test.ts src/discoverCommand.test.ts
```

Expected: FAIL because the discover CLI is absent.

- [ ] **Step 3: Implement authenticated one-request local IPC**

Use a Unix-domain socket under the session directory. Each connection sends one length-bounded JSON request containing the private token, command, session ID, and command payload; the host writes one bounded JSON response and closes the connection. Reject token/session mismatches before invoking the session engine. On Windows, use the equivalent named pipe path derived from the validated session ID.

- [ ] **Step 4: Implement detached host startup**

`discover start` validates all arguments, creates the session directory/bootstrap file, and spawns the current CLI executable with the private `__discover-host` subcommand using `detached: true` and ignored standard input. Redirect host diagnostics to session-local log files, call `unref()`, and poll bounded host metadata until the first frame is ready or startup fails. The public command must never print the token, bootstrap contents, raw trace, or log body.

- [ ] **Step 5: Implement exact CLI parsing and output**

Support:

```text
autodemo discover start --url <https-url> --goal <text> --risk <safe|public-browse|disposable|yolo> [--allowed-origin <origin>...] [--grid] --json
autodemo discover observe --session <id> [--grid] --json
autodemo discover act --session <id> --actions-file <json-file> --json
autodemo discover status --session <id> --json
autodemo discover finish --session <id> --json
autodemo discover abandon --session <id> --json
```

Require `--json` for every discover command. Read action files once, reject unsafe/non-file paths and oversized files, and pass parsed values to the host without logging them. Update root help with the public lifecycle but omit `__discover-host`.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
rtk npm test --workspace @auto-demo/cli -- --run src/discoverProtocol.test.ts src/discoverHost.test.ts src/discoverCommand.test.ts src/index.test.ts
rtk npm run typecheck --workspace @auto-demo/cli
rtk git diff --check
```

Expected: CLI parsing, detached host, reconnection, privacy, and cleanup tests pass.

```bash
rtk git add packages/cli/src/discoverProtocol.ts packages/cli/src/discoverProtocol.test.ts packages/cli/src/discoverHost.ts packages/cli/src/discoverHost.test.ts packages/cli/src/discoverCommand.ts packages/cli/src/discoverCommand.test.ts packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/package.json
rtk git commit -m "WES-273: add persistent coordinate discovery CLI"
```

### Task 8: Use The Shared Natural Driver In Discovery, Replay, And Recording

**Files:**

- Modify: `packages/agent/src/playwrightPointerActions.ts`
- Modify: `packages/agent/src/playwrightDiscoveryPage.ts`
- Modify: `packages/agent/src/playwrightDiscoveryReplay.ts`
- Test: `packages/agent/src/playwrightDiscoveryRehearsal.test.ts`
- Test: `packages/agent/src/playwrightDiscoveryReplay.test.ts`
- Modify: `packages/capture/src/playwrightPointerActions.ts`
- Modify: `packages/capture/src/playwrightAdapter.ts`
- Test: `packages/capture/src/playwrightPointerActions.test.ts`
- Test: `packages/capture/src/playwrightAdapter.test.ts`

- [ ] **Step 1: Strengthen failing public-behavior tests at all three boundaries**

Replace the current six-step pointer assertions with observable natural movement. For discovery, replay, and recording, assert intermediate physical mouse events, settling before down/up, location-aware wheel behavior where applicable, and keyboard-driven exact native selection. Assert no locator `click`, `fill`, `selectOption`, DOM-dispatched click, or direct selected-value mutation is required by the fake public browser boundary.

```ts
expect(browser.events).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ kind: "move" }),
    { kind: "down", button: "left" },
    { kind: "up", button: "left" },
  ]),
);
expect(browser.selectedOption()).toBe("Kia");
```

- [ ] **Step 2: Verify RED against the stronger behavior**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/playwrightDiscoveryRehearsal.test.ts src/playwrightDiscoveryReplay.test.ts
rtk npm test --workspace @auto-demo/capture -- --run src/playwrightPointerActions.test.ts src/playwrightAdapter.test.ts
```

Expected: FAIL because the existing helpers use fixed-step locator shortcuts and fill/select behavior.

- [ ] **Step 3: Adapt Playwright to the shared driver**

Create a small package-local port that forwards `move` to `page.mouse.move(x, y)`, down/up to `page.mouse.down/up`, wheel to `page.mouse.wheel`, keypress to `page.keyboard.press`, type to `page.keyboard.type`, and wait to `page.waitForTimeout`. Resolve semantic target bounding boxes, then pass their centers as destinations. Maintain one pointer state per browser page/session rather than recreating it per action.

- [ ] **Step 4: Preserve exact native selection with physical keys**

Pointer-focus the native select, cycle by the first public-label character, inspect only the publicly selected label, and press Enter once it exactly matches. Keep the existing overlapping-label and duplicate-public-label behavior. Never call `selectOption`, mutate `selectedIndex`, or dispatch synthetic change events.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/playwrightDiscoveryRehearsal.test.ts src/playwrightDiscoveryReplay.test.ts
rtk npm test --workspace @auto-demo/capture -- --run src/playwrightPointerActions.test.ts src/playwrightAdapter.test.ts
rtk npm run typecheck --workspace @auto-demo/agent
rtk npm run typecheck --workspace @auto-demo/capture
rtk git diff --check
```

Expected: discovery, replay, and recording all expose the same natural input behavior.

```bash
rtk git add packages/agent/src/playwrightPointerActions.ts packages/agent/src/playwrightDiscoveryPage.ts packages/agent/src/playwrightDiscoveryRehearsal.test.ts packages/agent/src/playwrightDiscoveryReplay.ts packages/agent/src/playwrightDiscoveryReplay.test.ts packages/capture/src/playwrightPointerActions.ts packages/capture/src/playwrightPointerActions.test.ts packages/capture/src/playwrightAdapter.ts packages/capture/src/playwrightAdapter.test.ts
rtk git commit -m "WES-273: share natural input across demo lifecycle"
```

### Task 9: Prove The CLI Vertically On A Local Browser Fixture

**Files:**

- Modify: `packages/cli/src/agenticDiscoveryAcceptance.test.ts`
- Create: `packages/cli/src/coordinateDiscoveryAcceptance.test.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Write a failing full-lifecycle acceptance test**

Serve a local fixture with a seven-control centered form, a custom scrollable dropdown, a native select with overlapping labels, a dynamic layout shift, sponsored and organic result cards, and a detail navigation. Drive it only through `runCliAsync` public discover commands and coordinate action files. Reuse one cached frame for stable form actions, force fresh frames at popup/scroll/navigation boundaries, finish into semantic replay, and assert review-required output selects exact labels and the first organic result.

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk npm test --workspace @auto-demo/cli -- --run src/coordinateDiscoveryAcceptance.test.ts
```

Expected: FAIL at the first missing or incorrect public lifecycle behavior.

- [ ] **Step 3: Make only integration corrections exposed by the acceptance test**

Correct wiring, lifecycle, or artifact mismatches in the smallest owning module. Do not introduce fixture-specific labels, coordinates, selectors, host scripts, or provider fields. For each correction, keep the acceptance test failing for the intended public reason before changing production code.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
rtk npm test --workspace @auto-demo/cli -- --run src/coordinateDiscoveryAcceptance.test.ts src/agenticDiscoveryAcceptance.test.ts
rtk npm run typecheck --workspace @auto-demo/cli
rtk git diff --check
```

Expected: old semantic discovery acceptance and new coordinate CLI acceptance both pass.

```bash
rtk git add packages/cli/src/coordinateDiscoveryAcceptance.test.ts packages/cli/src/agenticDiscoveryAcceptance.test.ts packages/cli/package.json
rtk git commit -m "WES-273: accept coordinate discovery end to end"
```

### Task 10: Publish Agent-Neutral CLI Instructions

**Files:**

- Create: `docs/guides/screenshot-coordinate-discovery.md`
- Modify: `README.md`
- Modify: `packages/agent/skills/codex-auto-demo/SKILL.md`
- Test: `packages/agent/src/wrapper-docs.test.ts`
- Test: `packages/cli/src/packaging-docs.test.ts`

- [ ] **Step 1: Write failing documentation-contract tests**

Assert the guide and Codex skill use the repo-root wrapper `npm run autodemo --`, name every lifecycle command, require reading `frame.screenshotPath`, use only PNG plus JSON, explain frame invalidation and dropdown scrolling, prohibit coordinates in replay, and contain no OpenAI API, Anthropic API, MCP, Playwright selector, or provider response-schema dependency.

- [ ] **Step 2: Verify RED**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/wrapper-docs.test.ts
rtk npm test --workspace @auto-demo/cli -- --run src/packaging-docs.test.ts
```

Expected: FAIL because the new CLI instructions are absent.

- [ ] **Step 3: Write exact copy-pasteable public workflow**

Document `start`, image reading, action-file creation, `act`, observation boundaries, targeted dropdown scroll, native popup capability errors, `status`, `finish`, repair frames, sanitized review, explicit approval, execution, and `abandon`. State that Codex is the first accepted host but the protocol contains no Codex-specific fields and Auto Demo never calls a model API.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
rtk npm test --workspace @auto-demo/agent -- --run src/wrapper-docs.test.ts
rtk npm test --workspace @auto-demo/cli -- --run src/packaging-docs.test.ts
rtk npm exec prettier -- --check README.md docs/guides/screenshot-coordinate-discovery.md packages/agent/skills/codex-auto-demo/SKILL.md
rtk git diff --check
```

Expected: documentation contracts, formatting, and diff checks pass.

```bash
rtk git add README.md docs/guides/screenshot-coordinate-discovery.md packages/agent/skills/codex-auto-demo/SKILL.md packages/agent/src/wrapper-docs.test.ts packages/cli/src/packaging-docs.test.ts
rtk git commit -m "WES-273: document coordinate discovery CLI"
```

### Task 11: Run Fresh Codex Cars.com Acceptance And Track Claude Follow-Up

**Files:**

- Create locally, do not commit: fresh clean acceptance checkout and its `workflow/<session-id>/**` artifacts
- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: `docs/superpowers/plans/2026-07-21-screenshot-coordinate-cli-discovery-implementation-plan.md`

- [ ] **Step 1: Create the deferred Claude Linear follow-up**

Use Linear CLI to create one follow-up issue in the same Auto Demo project/milestone with title `Run fresh Claude acceptance for screenshot-coordinate discovery CLI`. Its description must require the same PNG/JSON CLI with no provider adapter, record timing/turns/screenshots/batches/recoveries, and explicitly exclude implementation changes unless acceptance exposes a reproducible defect. Link it to WES-273 and record its identifier in the project map.

Expected: Claude testing is durable follow-up work, not a hidden WES-273 requirement.

- [ ] **Step 2: Build from a clean generated-artifact state**

Remove only issue-generated `packages/*/dist` directories using the repository's normal clean mechanism, then run:

```bash
rtk npm run build
rtk npm run typecheck:ci
```

Expected: the new workspace dependency builds correctly without stale declarations.

- [ ] **Step 3: Create a brand-new clean acceptance checkout**

Clone the current committed branch head into a temporary directory. Install dependencies from the lockfile, build, and verify empty status before beginning. Do not copy `.gitignore`, `.codex/`, `.lavish/`, `workflow/`, prior screenshots, or prior Cars.com guidance.

- [ ] **Step 4: Run a context-isolated Codex session with only the recorded prompt and published CLI guide**

The fresh session must start headed YOLO discovery with `npm run autodemo -- discover start`, read only returned PNG paths, submit coordinate actions through JSON files, use natural pointer movement, select New/Kia/Sorento/Nationwide or All miles, open the first organic listing, finish into fresh semantic replay, and return the full sanitized blocker-free review. No host-authored runner script, DOM target list, selectors, Cars.com coaching, editor, MP4 export, recording, or handoff is allowed before approval.

- [ ] **Step 5: Present review and obtain explicit user approval**

Return every ordered public step, warning, assumption, and blocker to the user. Continue only after the user explicitly approves that exact replay-validated plan. Persist approval through `autodemo agent approve`; conversation text alone is not execution authority.

- [ ] **Step 6: Record and hand off through the existing approved workflow**

Use the approved plan with `autodemo agent execute`, freshly select YOLO for recording, and create the project at `./demos/cars-kia-sorento` through `autodemo agent handoff`. Do not open the editor or export MP4.

- [ ] **Step 7: Validate artifacts and timing evidence**

Run in the acceptance checkout:

```bash
rtk npm run autodemo -- validate ./demos/cars-kia-sorento
rtk npm run autodemo -- agent run --project ./demos/cars-kia-sorento --json
```

Record total duration, Codex turns, screenshot count, action-batch count, observation boundaries, repair count, and recovery events in bounded WES-273 evidence. Confirm the durable plan/review/execution/handoff artifacts contain no raw coordinates, typed values, hidden target inventory, or provider-specific fields.

- [ ] **Step 8: Update stable evidence and commit**

Update the project map and this plan with the Claude follow-up identifier, clean branch head, prompt-only boundary, CLI acceptance result, timing evidence, replay validation, explicit approval, recording/handoff validation, and confirmation that editor/export stayed unused.

```bash
rtk git add docs/linear/auto-demo-project-structure.md docs/superpowers/plans/2026-07-21-screenshot-coordinate-cli-discovery-implementation-plan.md
rtk git commit -m "WES-273: record coordinate discovery acceptance"
```

### Task 12: Full Verification, Review, Publication, And Linear Sync

**Files:**

- Modify only if verification exposes an issue-scoped defect: the smallest owning production/test path
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run complete repository verification**

Run:

```bash
rtk npm run validate
rtk git diff --check
rtk git status --short
```

Expected: build, all typechecks, ESLint, all unit/browser/docs/acceptance tests, and Prettier pass; status contains only issue-owned work plus preserved unrelated `.gitignore`, `.codex/`, `.lavish/`, and `workflow/` paths.

- [ ] **Step 2: Run privacy and provider-neutrality scans**

Run targeted scans over committed product/docs/tests and generated acceptance artifacts. Expected: no runtime Cars.com input values in durable artifacts; no raw coordinate replay fields; no OpenAI/Anthropic API client; no MCP transport; no Codex-specific protocol field; no `selectOption` or DOM click shortcut in discovery/replay/recording execution paths.

- [ ] **Step 3: Request independent read-only review**

Give the reviewer WES-273, the approved design, this plan, branch diff, test evidence, fresh Codex transcript boundary, generated artifact inventory, and Claude follow-up issue. Require Critical/Important/Minor findings and a Ready/Not Ready verdict. Verify findings before changing code; use systematic debugging and RED-GREEN for valid defects.

- [ ] **Step 4: Publish and merge through the authorized delivery workflow**

Push the current branch, open a PR against `develop`, include design decisions and verification evidence, wait for required checks, address only verified issue-scoped failures, and merge when green. Never stage or publish the user's unrelated dirty paths or local acceptance media.

- [ ] **Step 5: Synchronize Linear and project state**

After merge, verify local `develop` and `origin/develop` contain the merge. Mark WES-273 Done with the PR/merge, fresh Codex acceptance, timing, approval, recording/handoff, and validation evidence. Keep the Claude follow-up open. Close WES-265 only if its dependency chain and project map now show no other incomplete requirement.

- [ ] **Step 6: Final audit**

Re-read WES-273, the Claude follow-up, project map, approved design, this plan, merged diff, and Git status. Confirm every checkbox is resolved, no required work is hidden in prose, and tracker/repository truth agree before reporting completion.
