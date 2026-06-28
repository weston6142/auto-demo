# WES-142 Playwright Viewport Media Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `autodemo capture` use a real Playwright-backed browser adapter that records viewport video and reports media path plus timing.

**Architecture:** Keep `packages/cli` as the lifecycle owner and put browser/media implementation in `packages/capture`. `packages/capture/src/index.ts` remains the public API surface, while focused internal modules own path handling, Playwright driver adaptation, and Playwright session state. Unit tests use fakes through an internal driver seam; a dedicated smoke test verifies the real Playwright path.

**Tech Stack:** TypeScript, Node ESM, npm workspaces, Vitest, Playwright bundled Chromium.

---

## File Structure

- Modify: `packages/capture/package.json`
  - Add `playwright` runtime dependency.
  - Expand unit test glob and add a dedicated smoke test script.
- Modify: `packages/capture/src/index.ts`
  - Export media/timing types.
  - Add new capture error codes.
  - Export `createPlaywrightBrowserCaptureAdapter()`.
  - Keep unsupported adapter behavior.
- Create: `packages/capture/src/capturePaths.ts`
  - Own output/media path construction and directory creation.
- Create: `packages/capture/src/playwrightDriver.ts`
  - Wrap the small subset of Playwright needed by the adapter.
  - Hide Playwright concrete types from public APIs and tests.
- Create: `packages/capture/src/playwrightAdapter.ts`
  - Implement adapter start and session stop behavior.
- Modify: `packages/capture/src/index.test.ts`
  - Update public type expectations and unsupported adapter coverage.
- Create: `packages/capture/src/capturePaths.test.ts`
  - Verify observable path helpers.
- Create: `packages/capture/src/playwrightAdapter.test.ts`
  - Verify Playwright adapter behavior with fake driver objects.
- Create: `packages/capture/src/playwrightAdapter.smoke.test.ts`
  - Launch a tiny local HTTP page and verify real Playwright creates a non-empty video.
- Modify: `packages/cli/src/index.ts`
  - Switch default backend to `createPlaywrightBrowserCaptureAdapter()`.
  - Keep parsing/lifecycle behavior unchanged.
- Modify: `packages/cli/src/index.test.ts`
  - Update fake successful stop results to include media and timing.
- Create: `packages/cli/src/defaultBackend.test.ts`
  - Mock `@auto-demo/capture` and verify the default path constructs the Playwright adapter, not the unsupported adapter.
- Modify: `packages/cli/package.json`
  - Expand test script to include all CLI test files.
- Modify: root `package.json`
  - Add a dedicated smoke script that runs capture smoke tests without slowing default `npm test`.

## Task 1: Public Capture Result Contract

**Files:**

- Modify: `packages/capture/src/index.ts`
- Modify: `packages/capture/src/index.test.ts`

- [ ] **Step 1: Write failing public contract tests**

Replace `packages/capture/src/index.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  createUnsupportedBrowserCaptureAdapter,
  manifestPathForOutputDir,
  type CaptureOutput,
} from "./index.js";

describe("createUnsupportedBrowserCaptureAdapter", () => {
  it("fails clearly while preserving the requested output paths", async () => {
    const adapter = createUnsupportedBrowserCaptureAdapter();
    const result = await adapter.start({
      source: { kind: "browser", url: "https://example.com" },
      outputDir: "demo-capture",
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-28T12:00:00.000Z",
      childCommand: {
        command: "npm",
        args: ["run", "demo:walkthrough"],
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "capture_not_implemented",
      message: "Browser capture is not implemented yet.",
      outputDir: "demo-capture",
      manifestPath: "demo-capture/capture.manifest.json",
    });
  });
});

describe("CaptureOutput", () => {
  it("represents the media path and timing returned by a successful capture", () => {
    const output: CaptureOutput = {
      outputDir: "demo-capture",
      manifestPath: "demo-capture/capture.manifest.json",
      media: {
        kind: "viewport",
        path: "demo-capture/media/viewport.webm",
        contentType: "video/webm",
      },
      timing: {
        startedAt: "2026-06-28T12:00:00.000Z",
        endedAt: "2026-06-28T12:00:03.250Z",
        durationMs: 3250,
      },
    };

    expect(output.media.path).toBe("demo-capture/media/viewport.webm");
    expect(output.timing.durationMs).toBe(3250);
  });
});

describe("manifestPathForOutputDir", () => {
  it("normalizes trailing slashes", () => {
    expect(manifestPathForOutputDir("demo-capture///")).toBe("demo-capture/capture.manifest.json");
  });
});
```

- [ ] **Step 2: Run the failing capture test**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: FAIL with TypeScript errors because `CaptureOutput` does not yet require `media` and `timing`.

- [ ] **Step 3: Update the public capture types**

Edit `packages/capture/src/index.ts` to match this public surface:

```ts
import { createPlaywrightBrowserCaptureAdapter } from "./playwrightAdapter.js";

export const CAPTURE_MANIFEST_FILENAME = "capture.manifest.json";
/** Default browser viewport used by `autodemo capture` when `--viewport` is omitted. */
export const DEFAULT_BROWSER_VIEWPORT = {
  width: 1280,
  height: 720,
} as const;

export type BrowserCaptureSource = {
  kind: "browser";
  url: string;
};

export type CaptureSource = BrowserCaptureSource;

export type CaptureViewport = {
  width: number;
  height: number;
};

export type CaptureChildCommand = {
  command: string;
  args: string[];
};

export type BrowserCaptureOptions = {
  source: BrowserCaptureSource;
  outputDir: string;
  viewport: CaptureViewport;
  startedAt: string;
  childCommand?: CaptureChildCommand;
};

export type CaptureStopReason = "completed" | "failed" | "interrupted";

export type CaptureMediaArtifact = {
  kind: "viewport";
  path: string;
  contentType: "video/webm";
};

export type CaptureTiming = {
  startedAt: string;
  endedAt: string;
  durationMs: number;
};

export type CaptureOutput = {
  outputDir: string;
  manifestPath: string;
  media: CaptureMediaArtifact;
  timing: CaptureTiming;
};

export type CaptureErrorCode =
  "capture_not_implemented" | "capture_setup_failed" | "capture_stop_failed";

export type CaptureStartResult =
  | {
      ok: true;
      session: CaptureSession;
      outputDir: string;
      manifestPath: string;
    }
  | {
      ok: false;
      code: CaptureErrorCode;
      message: string;
      outputDir: string;
      manifestPath: string;
    };

export type CaptureStopResult =
  | {
      ok: true;
      output: CaptureOutput;
    }
  | {
      ok: false;
      code: CaptureErrorCode;
      message: string;
      outputDir: string;
      manifestPath: string;
    };

export type CaptureSession = {
  readonly outputDir: string;
  readonly manifestPath: string;
  stop(reason: CaptureStopReason): Promise<CaptureStopResult>;
};

export type BrowserCaptureAdapter = {
  readonly kind: "browser";
  start(options: BrowserCaptureOptions): Promise<CaptureStartResult>;
};

/** Creates the default browser capture backend for real viewport media recording. */
export { createPlaywrightBrowserCaptureAdapter };

/** Creates a backend that reports unsupported capture. Useful for tests and explicit fallback behavior. */
export function createUnsupportedBrowserCaptureAdapter(): BrowserCaptureAdapter {
  return {
    kind: "browser",
    async start(options) {
      return {
        ok: false,
        code: "capture_not_implemented",
        message: "Browser capture is not implemented yet.",
        outputDir: options.outputDir,
        manifestPath: manifestPathForOutputDir(options.outputDir),
      };
    },
  };
}

/** Returns the capture manifest path inside a capture bundle output directory. */
export function manifestPathForOutputDir(outputDir: string): string {
  return `${trimTrailingSlashes(outputDir)}/${CAPTURE_MANIFEST_FILENAME}`;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
```

- [ ] **Step 4: Add a temporary adapter export stub so the public type test compiles**

Create `packages/capture/src/playwrightAdapter.ts`:

```ts
import type { BrowserCaptureAdapter } from "./index.js";

export function createPlaywrightBrowserCaptureAdapter(): BrowserCaptureAdapter {
  return {
    kind: "browser",
    async start(options) {
      return {
        ok: false,
        code: "capture_setup_failed",
        message: "Playwright browser capture is not implemented yet.",
        outputDir: options.outputDir,
        manifestPath: `${options.outputDir.replace(/\/+$/, "")}/capture.manifest.json`,
      };
    },
  };
}
```

- [ ] **Step 5: Run the public contract test**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: PASS.

- [ ] **Step 6: Commit the public contract**

Run:

```bash
git add packages/capture/src/index.ts packages/capture/src/index.test.ts packages/capture/src/playwrightAdapter.ts
git commit -m "feat: extend capture stop result contract"
```

## Task 2: Capture Path Helpers

**Files:**

- Create: `packages/capture/src/capturePaths.ts`
- Create: `packages/capture/src/capturePaths.test.ts`
- Modify: `packages/capture/package.json`

- [ ] **Step 1: Expand the capture unit test script**

Edit `packages/capture/package.json`:

```json
{
  "name": "@auto-demo/capture",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run src/index.test.ts src/capturePaths.test.ts src/playwrightAdapter.test.ts",
    "test:smoke": "vitest run src/*.smoke.test.ts"
  }
}
```

- [ ] **Step 2: Write failing path helper tests**

Create `packages/capture/src/capturePaths.test.ts`:

```ts
import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildCapturePaths, ensureCaptureDirectories } from "./capturePaths.js";

describe("buildCapturePaths", () => {
  it("builds stable capture paths under the output directory", () => {
    expect(buildCapturePaths("demo-capture///")).toEqual({
      outputDir: "demo-capture",
      manifestPath: "demo-capture/capture.manifest.json",
      mediaDir: "demo-capture/media",
      viewportMediaPath: "demo-capture/media/viewport.webm",
    });
  });
});

describe("ensureCaptureDirectories", () => {
  it("creates the output and media directories", async () => {
    const root = await mkdtemp(join(tmpdir(), "auto-demo-capture-paths-"));
    const paths = buildCapturePaths(join(root, "demo-capture"));

    await ensureCaptureDirectories(paths);

    await expect(stat(paths.outputDir)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
    await expect(stat(paths.mediaDir)).resolves.toMatchObject({
      isDirectory: expect.any(Function),
    });
  });
});
```

- [ ] **Step 3: Run the failing path helper tests**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: FAIL because `capturePaths.ts` does not exist.

- [ ] **Step 4: Implement path helpers**

Create `packages/capture/src/capturePaths.ts`:

```ts
import { mkdir } from "node:fs/promises";

export type CapturePaths = {
  outputDir: string;
  manifestPath: string;
  mediaDir: string;
  viewportMediaPath: string;
};

export function buildCapturePaths(outputDir: string): CapturePaths {
  const normalizedOutputDir = trimTrailingSlashes(outputDir);
  const mediaDir = `${normalizedOutputDir}/media`;

  return {
    outputDir: normalizedOutputDir,
    manifestPath: `${normalizedOutputDir}/capture.manifest.json`,
    mediaDir,
    viewportMediaPath: `${mediaDir}/viewport.webm`,
  };
}

export async function ensureCaptureDirectories(paths: CapturePaths): Promise<void> {
  await mkdir(paths.mediaDir, { recursive: true });
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
```

- [ ] **Step 5: Run path helper tests**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: PASS.

- [ ] **Step 6: Commit path helpers**

Run:

```bash
git add packages/capture/package.json packages/capture/src/capturePaths.ts packages/capture/src/capturePaths.test.ts
git commit -m "feat: add capture output path helpers"
```

## Task 3: Internal Playwright Driver Seam

**Files:**

- Create: `packages/capture/src/playwrightDriver.ts`
- Modify: `packages/capture/package.json`

- [ ] **Step 1: Add Playwright as the capture package dependency**

Run:

```bash
npm install playwright --workspace @auto-demo/capture
```

Expected: `packages/capture/package.json` has a `dependencies.playwright` entry and `package-lock.json` updates.

- [ ] **Step 2: Implement the internal Playwright driver wrapper**

Create `packages/capture/src/playwrightDriver.ts`:

```ts
import { chromium, type Browser, type BrowserContext, type Page, type Video } from "playwright";
import type { CaptureViewport } from "./index.js";

export type PlaywrightDriver = {
  launchChromium(): Promise<PlaywrightBrowser>;
};

export type PlaywrightBrowser = {
  newContext(options: PlaywrightContextOptions): Promise<PlaywrightBrowserContext>;
  close(): Promise<void>;
};

export type PlaywrightContextOptions = {
  viewport: CaptureViewport;
  recordVideo: {
    dir: string;
  };
};

export type PlaywrightBrowserContext = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

export type PlaywrightPage = {
  goto(url: string): Promise<void>;
  video(): PlaywrightVideo | null;
};

export type PlaywrightVideo = {
  path(): Promise<string>;
};

export function createDefaultPlaywrightDriver(): PlaywrightDriver {
  return {
    async launchChromium() {
      const browser = await chromium.launch();
      return wrapBrowser(browser);
    },
  };
}

function wrapBrowser(browser: Browser): PlaywrightBrowser {
  return {
    async newContext(options) {
      const context = await browser.newContext(options);
      return wrapContext(context);
    },
    async close() {
      await browser.close();
    },
  };
}

function wrapContext(context: BrowserContext): PlaywrightBrowserContext {
  return {
    async newPage() {
      const page = await context.newPage();
      return wrapPage(page);
    },
    async close() {
      await context.close();
    },
  };
}

function wrapPage(page: Page): PlaywrightPage {
  return {
    async goto(url) {
      await page.goto(url);
    },
    video() {
      const video = page.video();
      return video === null ? null : wrapVideo(video);
    },
  };
}

function wrapVideo(video: Video): PlaywrightVideo {
  return {
    async path() {
      return await video.path();
    },
  };
}
```

- [ ] **Step 3: Run typecheck**

Run:

```bash
rtk npm --workspace @auto-demo/capture run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit the driver seam**

Run:

```bash
git add package-lock.json packages/capture/package.json packages/capture/src/playwrightDriver.ts
git commit -m "feat: add internal Playwright driver seam"
```

## Task 4: Playwright Adapter Start Behavior

**Files:**

- Modify: `packages/capture/src/playwrightAdapter.ts`
- Create: `packages/capture/src/playwrightAdapter.test.ts`

- [ ] **Step 1: Write failing start behavior tests**

Create `packages/capture/src/playwrightAdapter.test.ts`:

```ts
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createPlaywrightBrowserCaptureAdapterForDriver } from "./playwrightAdapter.js";
import type {
  PlaywrightBrowser,
  PlaywrightBrowserContext,
  PlaywrightDriver,
  PlaywrightPage,
  PlaywrightVideo,
} from "./playwrightDriver.js";

class FakeVideo implements PlaywrightVideo {
  constructor(private readonly videoPath: string) {}

  async path(): Promise<string> {
    return this.videoPath;
  }
}

class FakePage implements PlaywrightPage {
  public readonly gotos: string[] = [];

  constructor(private readonly fakeVideo: PlaywrightVideo | null) {}

  async goto(url: string): Promise<void> {
    this.gotos.push(url);
  }

  video(): PlaywrightVideo | null {
    return this.fakeVideo;
  }
}

class FakeContext implements PlaywrightBrowserContext {
  public closed = false;

  constructor(public readonly page: FakePage) {}

  async newPage(): Promise<PlaywrightPage> {
    return this.page;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeBrowser implements PlaywrightBrowser {
  public closed = false;
  public readonly newContextOptions: unknown[] = [];

  constructor(public readonly context: FakeContext) {}

  async newContext(options: unknown): Promise<PlaywrightBrowserContext> {
    this.newContextOptions.push(options);
    return this.context;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeDriver implements PlaywrightDriver {
  public readonly browser: FakeBrowser;

  constructor(videoPath: string) {
    this.browser = new FakeBrowser(new FakeContext(new FakePage(new FakeVideo(videoPath))));
  }

  async launchChromium(): Promise<PlaywrightBrowser> {
    return this.browser;
  }
}

describe("createPlaywrightBrowserCaptureAdapter", () => {
  it("launches bundled Chromium with viewport recording and navigates to the source URL", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-unit-"));
    const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
    const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
      now: () => new Date("2026-06-28T12:00:00.000Z"),
    });

    const result = await adapter.start({
      source: { kind: "browser", url: "https://example.com/demo" },
      outputDir: `${outputDir}///`,
      viewport: { width: 1440, height: 900 },
      startedAt: "2026-06-28T11:59:59.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.outputDir).toBe(outputDir);
    expect(result.manifestPath).toBe(`${outputDir}/capture.manifest.json`);
    expect(driver.browser.newContextOptions).toEqual([
      {
        viewport: { width: 1440, height: 900 },
        recordVideo: { dir: `${outputDir}/media` },
      },
    ]);
    expect(driver.browser.context.page.gotos).toEqual(["https://example.com/demo"]);
    expect(result.session.outputDir).toBe(outputDir);
    expect(result.session.manifestPath).toBe(`${outputDir}/capture.manifest.json`);
  });
});
```

- [ ] **Step 2: Run the failing adapter test**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: FAIL because `createPlaywrightBrowserCaptureAdapterForDriver` does not exist.

- [ ] **Step 3: Implement start behavior**

Replace `packages/capture/src/playwrightAdapter.ts` with:

```ts
import { rename } from "node:fs/promises";
import type {
  BrowserCaptureAdapter,
  BrowserCaptureOptions,
  CaptureOutput,
  CaptureStartResult,
  CaptureStopReason,
  CaptureStopResult,
} from "./index.js";
import { buildCapturePaths, ensureCaptureDirectories, type CapturePaths } from "./capturePaths.js";
import {
  createDefaultPlaywrightDriver,
  type PlaywrightBrowser,
  type PlaywrightBrowserContext,
  type PlaywrightDriver,
  type PlaywrightPage,
} from "./playwrightDriver.js";

type PlaywrightAdapterDependencies = {
  now: () => Date;
};

export function createPlaywrightBrowserCaptureAdapter(): BrowserCaptureAdapter {
  return createPlaywrightBrowserCaptureAdapterForDriver(createDefaultPlaywrightDriver(), {
    now: () => new Date(),
  });
}

export function createPlaywrightBrowserCaptureAdapterForDriver(
  driver: PlaywrightDriver,
  dependencies: PlaywrightAdapterDependencies,
): BrowserCaptureAdapter {
  return {
    kind: "browser",
    async start(options) {
      return await startPlaywrightCapture(driver, dependencies, options);
    },
  };
}

async function startPlaywrightCapture(
  driver: PlaywrightDriver,
  dependencies: PlaywrightAdapterDependencies,
  options: BrowserCaptureOptions,
): Promise<CaptureStartResult> {
  const paths = buildCapturePaths(options.outputDir);
  let browser: PlaywrightBrowser | undefined;
  let context: PlaywrightBrowserContext | undefined;

  try {
    await ensureCaptureDirectories(paths);
    browser = await driver.launchChromium();
    context = await browser.newContext({
      viewport: options.viewport,
      recordVideo: {
        dir: paths.mediaDir,
      },
    });
    const page = await context.newPage();
    await page.goto(options.source.url);

    return {
      ok: true,
      outputDir: paths.outputDir,
      manifestPath: paths.manifestPath,
      session: new PlaywrightCaptureSession({
        browser,
        context,
        page,
        paths,
        startedAt: dependencies.now(),
      }),
    };
  } catch {
    await closeQuietly(context);
    await closeQuietly(browser);

    return {
      ok: false,
      code: "capture_setup_failed",
      message: "Browser capture setup failed.",
      outputDir: paths.outputDir,
      manifestPath: paths.manifestPath,
    };
  }
}

class PlaywrightCaptureSession {
  public readonly outputDir: string;
  public readonly manifestPath: string;
  private stopResult: CaptureStopResult | undefined;

  constructor(
    private readonly state: {
      browser: PlaywrightBrowser;
      context: PlaywrightBrowserContext;
      page: PlaywrightPage;
      paths: CapturePaths;
      startedAt: Date;
    },
  ) {
    this.outputDir = state.paths.outputDir;
    this.manifestPath = state.paths.manifestPath;
  }

  async stop(_reason: CaptureStopReason): Promise<CaptureStopResult> {
    if (this.stopResult !== undefined) {
      return this.stopResult;
    }

    const video = this.state.page.video();
    try {
      await this.state.context.close();
      await this.state.browser.close();
      if (video === null) {
        this.stopResult = this.stopFailed();
        return this.stopResult;
      }

      const generatedPath = await video.path();
      const mediaPath = await moveViewportVideo(generatedPath, this.state.paths.viewportMediaPath);
      const endedAt = new Date();
      const output: CaptureOutput = {
        outputDir: this.state.paths.outputDir,
        manifestPath: this.state.paths.manifestPath,
        media: {
          kind: "viewport",
          path: mediaPath,
          contentType: "video/webm",
        },
        timing: {
          startedAt: this.state.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - this.state.startedAt.getTime(),
        },
      };
      this.stopResult = { ok: true, output };
      return this.stopResult;
    } catch {
      await closeQuietly(this.state.browser);
      this.stopResult = this.stopFailed();
      return this.stopResult;
    }
  }

  private stopFailed(): CaptureStopResult {
    return {
      ok: false,
      code: "capture_stop_failed",
      message: "Browser capture stop failed.",
      outputDir: this.state.paths.outputDir,
      manifestPath: this.state.paths.manifestPath,
    };
  }
}

async function moveViewportVideo(
  generatedPath: string,
  viewportMediaPath: string,
): Promise<string> {
  if (generatedPath === viewportMediaPath) {
    return generatedPath;
  }

  try {
    await rename(generatedPath, viewportMediaPath);
    return viewportMediaPath;
  } catch {
    return generatedPath;
  }
}

async function closeQuietly(resource: { close(): Promise<void> } | undefined): Promise<void> {
  try {
    await resource?.close();
  } catch {
    // Preserve the original setup or stop failure.
  }
}
```

- [ ] **Step 4: Run the adapter start test**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: PASS.

- [ ] **Step 5: Commit start behavior**

Run:

```bash
git add packages/capture/src/playwrightAdapter.ts packages/capture/src/playwrightAdapter.test.ts
git commit -m "feat: launch Playwright browser capture sessions"
```

## Task 5: Playwright Adapter Stop Behavior And Failure Cases

**Files:**

- Modify: `packages/capture/src/playwrightAdapter.test.ts`
- Modify: `packages/capture/src/playwrightAdapter.ts`

- [ ] **Step 1: Add stop behavior tests**

Append these tests inside the existing `describe("createPlaywrightBrowserCaptureAdapter", () => { ... })` block in `packages/capture/src/playwrightAdapter.test.ts`:

```ts
it("returns media and timing when the session stops", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-stop-"));
  const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
  const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
    now: (() => {
      const dates = [new Date("2026-06-28T12:00:00.000Z"), new Date("2026-06-28T12:00:02.500Z")];
      return () => dates.shift() ?? new Date("2026-06-28T12:00:02.500Z");
    })(),
  });

  const startResult = await adapter.start({
    source: { kind: "browser", url: "https://example.com/demo" },
    outputDir,
    viewport: { width: 1280, height: 720 },
    startedAt: "2026-06-28T11:59:59.000Z",
  });

  expect(startResult.ok).toBe(true);
  if (!startResult.ok) {
    return;
  }

  const stopResult = await startResult.session.stop("completed");

  expect(stopResult).toEqual({
    ok: true,
    output: {
      outputDir,
      manifestPath: `${outputDir}/capture.manifest.json`,
      media: {
        kind: "viewport",
        path: `${outputDir}/media/raw.webm`,
        contentType: "video/webm",
      },
      timing: {
        startedAt: "2026-06-28T12:00:00.000Z",
        endedAt: "2026-06-28T12:00:02.500Z",
        durationMs: 2500,
      },
    },
  });
  expect(driver.browser.context.closed).toBe(true);
  expect(driver.browser.closed).toBe(true);
});

it("returns the same result when stop is called twice", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-double-stop-"));
  const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
  const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
    now: () => new Date("2026-06-28T12:00:00.000Z"),
  });
  const startResult = await adapter.start({
    source: { kind: "browser", url: "https://example.com/demo" },
    outputDir,
    viewport: { width: 1280, height: 720 },
    startedAt: "2026-06-28T12:00:00.000Z",
  });

  expect(startResult.ok).toBe(true);
  if (!startResult.ok) {
    return;
  }

  const first = await startResult.session.stop("completed");
  const second = await startResult.session.stop("interrupted");

  expect(second).toEqual(first);
});

it("returns a setup failure and closes partial resources when navigation fails", async () => {
  class FailingPage extends FakePage {
    override async goto(): Promise<void> {
      throw new Error("navigation failed");
    }
  }

  class FailingContext extends FakeContext {
    constructor() {
      super(new FailingPage(new FakeVideo("unused.webm")));
    }
  }

  class FailingBrowser extends FakeBrowser {
    constructor() {
      super(new FailingContext());
    }
  }

  class FailingDriver implements PlaywrightDriver {
    public readonly browser = new FailingBrowser();

    async launchChromium(): Promise<PlaywrightBrowser> {
      return this.browser;
    }
  }

  const driver = new FailingDriver();
  const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-setup-failure-"));
  const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
    now: () => new Date("2026-06-28T12:00:00.000Z"),
  });

  const result = await adapter.start({
    source: { kind: "browser", url: "https://example.com/demo" },
    outputDir,
    viewport: { width: 1280, height: 720 },
    startedAt: "2026-06-28T12:00:00.000Z",
  });

  expect(result).toEqual({
    ok: false,
    code: "capture_setup_failed",
    message: "Browser capture setup failed.",
    outputDir,
    manifestPath: `${outputDir}/capture.manifest.json`,
  });
  expect(driver.browser.context.closed).toBe(true);
  expect(driver.browser.closed).toBe(true);
});
```

- [ ] **Step 2: Run the stop behavior tests**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: FAIL because the current implementation uses `new Date()` directly for stop timing.

- [ ] **Step 3: Use the injected clock for stop timing**

Edit `packages/capture/src/playwrightAdapter.ts`:

```ts
class PlaywrightCaptureSession {
  public readonly outputDir: string;
  public readonly manifestPath: string;
  private stopResult: CaptureStopResult | undefined;

  constructor(
    private readonly state: {
      browser: PlaywrightBrowser;
      context: PlaywrightBrowserContext;
      page: PlaywrightPage;
      paths: CapturePaths;
      startedAt: Date;
      now: () => Date;
    },
  ) {
    this.outputDir = state.paths.outputDir;
    this.manifestPath = state.paths.manifestPath;
  }

  async stop(_reason: CaptureStopReason): Promise<CaptureStopResult> {
    if (this.stopResult !== undefined) {
      return this.stopResult;
    }

    const video = this.state.page.video();
    try {
      await this.state.context.close();
      await this.state.browser.close();
      if (video === null) {
        this.stopResult = this.stopFailed();
        return this.stopResult;
      }

      const generatedPath = await video.path();
      const mediaPath = await moveViewportVideo(generatedPath, this.state.paths.viewportMediaPath);
      const endedAt = this.state.now();
      const output: CaptureOutput = {
        outputDir: this.state.paths.outputDir,
        manifestPath: this.state.paths.manifestPath,
        media: {
          kind: "viewport",
          path: mediaPath,
          contentType: "video/webm",
        },
        timing: {
          startedAt: this.state.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - this.state.startedAt.getTime(),
        },
      };
      this.stopResult = { ok: true, output };
      return this.stopResult;
    } catch {
      await closeQuietly(this.state.browser);
      this.stopResult = this.stopFailed();
      return this.stopResult;
    }
  }
}
```

Also update the session construction in `startPlaywrightCapture()`:

```ts
session: new PlaywrightCaptureSession({
  browser,
  context,
  page,
  paths,
  startedAt: dependencies.now(),
  now: dependencies.now,
}),
```

- [ ] **Step 4: Run the capture tests**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: PASS.

- [ ] **Step 5: Commit stop behavior**

Run:

```bash
git add packages/capture/src/playwrightAdapter.ts packages/capture/src/playwrightAdapter.test.ts
git commit -m "feat: finalize Playwright capture stop results"
```

## Task 6: CLI Default Backend Switch

**Files:**

- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/index.test.ts`
- Create: `packages/cli/src/defaultBackend.test.ts`
- Modify: `packages/cli/package.json`

- [ ] **Step 1: Expand the CLI test script**

Edit `packages/cli/package.json`:

```json
{
  "name": "@auto-demo/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "autodemo": "dist/index.js"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "prebuild": "npm run build -w @auto-demo/capture",
    "build": "tsc -p tsconfig.json",
    "pretypecheck": "npm run build -w @auto-demo/capture",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "pretest": "npm run build -w @auto-demo/capture",
    "test": "vitest run src/index.test.ts src/defaultBackend.test.ts"
  },
  "dependencies": {
    "@auto-demo/capture": "0.0.0"
  }
}
```

- [ ] **Step 2: Update existing CLI fake stop results**

In `packages/cli/src/index.test.ts`, every fake successful `stop()` currently returns:

```ts
return {
  ok: true,
  output: {
    outputDir: options.outputDir,
    manifestPath: `${options.outputDir}/capture.manifest.json`,
  },
};
```

Replace each occurrence with:

```ts
return {
  ok: true,
  output: {
    outputDir: options.outputDir,
    manifestPath: `${options.outputDir}/capture.manifest.json`,
    media: {
      kind: "viewport",
      path: `${options.outputDir}/media/viewport.webm`,
      contentType: "video/webm",
    },
    timing: {
      startedAt: "2026-06-28T12:00:00.000Z",
      endedAt: "2026-06-28T12:00:02.500Z",
      durationMs: 2500,
    },
  },
};
```

- [ ] **Step 3: Write failing default backend test**

Create `packages/cli/src/defaultBackend.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { BrowserCaptureOptions } from "@auto-demo/capture";

const factoryCalls: string[] = [];

vi.mock("@auto-demo/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@auto-demo/capture")>();
  return {
    ...actual,
    createUnsupportedBrowserCaptureAdapter: () => {
      factoryCalls.push("unsupported");
      return actual.createUnsupportedBrowserCaptureAdapter();
    },
    createPlaywrightBrowserCaptureAdapter: () => {
      factoryCalls.push("playwright");
      return {
        kind: "browser" as const,
        async start(options: BrowserCaptureOptions) {
          return {
            ok: false as const,
            code: "capture_setup_failed" as const,
            message: "mock playwright setup failed",
            outputDir: options.outputDir,
            manifestPath: `${options.outputDir}/capture.manifest.json`,
          };
        },
      };
    },
  };
});

describe("default capture backend", () => {
  it("uses the Playwright browser capture adapter", async () => {
    factoryCalls.length = 0;
    const { runCliAsync } = await import("./index.js");

    const result = await runCliAsync([
      "capture",
      "--url",
      "https://example.com",
      "--out",
      "demo-capture",
    ]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "mock playwright setup failed\n",
    });
    expect(factoryCalls).toEqual(["playwright"]);
  });
});
```

- [ ] **Step 4: Run the failing CLI tests**

Run:

```bash
rtk npm --workspace @auto-demo/cli test
```

Expected: FAIL because the default backend still uses the unsupported adapter.

- [ ] **Step 5: Switch CLI default backend**

Edit the import in `packages/cli/src/index.ts` from:

```ts
import {
  createUnsupportedBrowserCaptureAdapter,
  DEFAULT_BROWSER_VIEWPORT,
  type BrowserCaptureAdapter,
  type BrowserCaptureOptions,
  type CaptureChildCommand,
  type CaptureSession,
  type CaptureStopReason,
  type CaptureViewport,
} from "@auto-demo/capture";
```

to:

```ts
import {
  createPlaywrightBrowserCaptureAdapter,
  DEFAULT_BROWSER_VIEWPORT,
  type BrowserCaptureAdapter,
  type BrowserCaptureOptions,
  type CaptureChildCommand,
  type CaptureSession,
  type CaptureStopReason,
  type CaptureViewport,
} from "@auto-demo/capture";
```

Edit `defaultDependencies()` in `packages/cli/src/index.ts`:

```ts
function defaultDependencies(): CliDependencies {
  return {
    browserCaptureAdapter: createPlaywrightBrowserCaptureAdapter(),
    createInterruptWatcher: createSigintInterruptWatcher,
    now: () => new Date(),
    runChildCommand: runChildCommandWithInheritedStdio,
  };
}
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
rtk npm --workspace @auto-demo/cli test
```

Expected: PASS.

- [ ] **Step 7: Commit CLI default switch**

Run:

```bash
git add packages/cli/package.json packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/src/defaultBackend.test.ts
git commit -m "feat: use Playwright capture by default"
```

## Task 7: Real Playwright Smoke Test

**Files:**

- Create: `packages/capture/src/playwrightAdapter.smoke.test.ts`
- Modify: root `package.json`

- [ ] **Step 1: Add root smoke script**

Edit root `package.json` scripts:

```json
{
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "test:smoke": "npm --workspace @auto-demo/capture run test:smoke",
    "lint": "eslint .",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "validate": "npm run build && npm run typecheck && npm run lint && npm test && npm run format:check"
  }
}
```

- [ ] **Step 2: Write failing smoke test**

Create `packages/capture/src/playwrightAdapter.smoke.test.ts`:

```ts
import { createServer } from "node:http";
import { mkdtemp, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPlaywrightBrowserCaptureAdapter } from "./index.js";

let closeServer: (() => Promise<void>) | undefined;

beforeEach(() => {
  closeServer = undefined;
});

afterEach(async () => {
  await closeServer?.();
});

describe("createPlaywrightBrowserCaptureAdapter smoke", () => {
  it("records a non-empty viewport video", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`
        <!doctype html>
        <html>
          <head><title>Auto Demo Smoke</title></head>
          <body>
            <main style="font-family: sans-serif">
              <h1>Auto Demo Smoke</h1>
              <button>Record me</button>
            </main>
          </body>
        </html>
      `);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    closeServer = async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
            return;
          }
          reject(error);
        });
      });
    };

    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected TCP server address.");
    }

    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-smoke-"));
    const adapter = createPlaywrightBrowserCaptureAdapter();
    const start = await adapter.start({
      source: { kind: "browser", url: `http://127.0.0.1:${address.port}` },
      outputDir,
      viewport: { width: 640, height: 360 },
      startedAt: "2026-06-28T12:00:00.000Z",
    });

    expect(start.ok).toBe(true);
    if (!start.ok) {
      throw new Error(start.message);
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500);
    });

    const stop = await start.session.stop("completed");

    expect(stop.ok).toBe(true);
    if (!stop.ok) {
      throw new Error(stop.message);
    }

    const mediaStat = await stat(stop.output.media.path);
    expect(mediaStat.size).toBeGreaterThan(0);
    expect(stop.output.media.contentType).toBe("video/webm");
    expect(stop.output.timing.durationMs).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
```

- [ ] **Step 3: Run smoke test**

Run:

```bash
rtk npm run test:smoke
```

Expected: PASS when Playwright browsers are installed. If it fails with a Playwright browser-install message, run the exact install command from the error, then rerun `rtk npm run test:smoke`.

- [ ] **Step 4: Commit smoke coverage**

Run:

```bash
git add package.json packages/capture/src/playwrightAdapter.smoke.test.ts
git commit -m "test: add Playwright capture smoke test"
```

## Task 8: Validation And Documentation Sync

**Files:**

- Modify: `README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Update README capture status**

Edit the `Status` and `CLI` sections in `README.md` so they say:

```md
## Status

This repository is in early capture-runtime setup. The package structure exists, and `autodemo capture` now launches a Playwright-controlled Chromium browser for viewport media recording. Interaction metadata, durable manifests, polish, render, and editor behavior are still planned work.
```

In the CLI section, replace the unsupported-backend sentence with:

```md
The CLI validates `--url`, `--out`, optional `--viewport`, and an optional child command after `--`. The default viewport is `1280x720`. The default browser backend uses Playwright's bundled Chromium and records viewport media without OS screen-recording permissions.
```

- [ ] **Step 2: Update Linear project map notes**

Add this note under `## Investigation Notes` in `docs/linear/auto-demo-project-structure.md`:

```md
- 2026-06-28 WES-142 implementation plan: Playwright becomes the default `autodemo capture` backend. WES-142 returns media path and timing from `session.stop()` but does not write the durable manifest; WES-147 still owns manifest writing. WES-145 still owns interaction metadata.
```

Add this line under `## Completion Evidence` only after implementation and verification pass:

```md
- WES-142: Playwright viewport media recording implemented as the default CLI capture backend; smoke test verifies a non-empty viewport video file, and unit tests cover adapter start/stop behavior through fakes.
```

- [ ] **Step 3: Run focused validation**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
rtk npm --workspace @auto-demo/cli test
rtk npm run test:smoke
rtk npm run validate
```

Expected: all commands PASS.

- [ ] **Step 4: Commit docs and validation sync**

Run:

```bash
git add README.md docs/linear/auto-demo-project-structure.md
git commit -m "docs: document Playwright capture backend"
```

## Self-Review Notes

- Spec coverage: the plan covers default Playwright backend, bundled Chromium launch, media/timing stop result, no manifest writing, no metadata capture, setup/stop cleanup, fake-driven unit tests, and a real smoke test.
- Scope check: WES-145 metadata, WES-147 manifest writing, and WES-146 broad failure hardening remain out of implementation scope except for explicit docs notes.
- Type consistency: public success output uses `media` and `timing` on `CaptureOutput`; failure results retain `outputDir` and `manifestPath`.
- Test intent: unit tests assert observable adapter behavior through an internal fake driver; the only real browser dependency is isolated in `test:smoke`.
