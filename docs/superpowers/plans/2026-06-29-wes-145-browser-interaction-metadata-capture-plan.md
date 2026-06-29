# WES-145 Browser Interaction Metadata Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add browser interaction metadata capture that writes ordered JSONL events beside Playwright viewport media and returns the metadata artifact path from successful captures.

**Architecture:** Keep `packages/cli` as the capture lifecycle owner and implement metadata inside `packages/capture`. Extend the current Playwright adapter with focused modules for paths, event modeling, JSONL writing, and page instrumentation. Write `metadata/events.jsonl` incrementally, redact typed values by default, and leave durable manifest writing to WES-147.

**Tech Stack:** TypeScript, Node ESM, npm workspaces, Vitest, Playwright, JSONL.

---

## File Structure

- Modify: `packages/capture/src/index.ts`
  - Add `CaptureMetadataArtifact`.
  - Add `metadata` to `CaptureOutput`.
  - Export capture event types if consumers/tests need them.
- Modify: `packages/capture/src/capturePaths.ts`
  - Add `metadataDir` and `eventsPath`.
  - Ensure metadata directory is created with the media directory.
- Modify: `packages/capture/src/capturePaths.test.ts`
  - Cover the new metadata paths.
- Create: `packages/capture/src/captureEvents.ts`
  - Own `CaptureEvent`, `CaptureEventType`, `CapturedValueKind`, timestamp/sequence event factory, target hint types, typed-value classification, and redaction helpers.
- Create: `packages/capture/src/captureEvents.test.ts`
  - Verify sequence/timestamp behavior and redaction/classification.
- Create: `packages/capture/src/jsonlEventWriter.ts`
  - Own append-only JSONL event writing, flush, and close.
- Create: `packages/capture/src/jsonlEventWriter.test.ts`
  - Verify parseable lines and close/flush behavior.
- Modify: `packages/capture/src/playwrightDriver.ts`
  - Extend the internal driver seam with event observer hooks and browser-side binding/init-script support.
- Create: `packages/capture/src/playwrightMetadataRecorder.ts`
  - Attach Playwright/page observers and browser-side listeners.
  - Normalize incoming events into `CaptureEvent` objects.
- Create: `packages/capture/src/playwrightMetadataRecorder.test.ts`
  - Verify fake page/context events are written as expected.
- Modify: `packages/capture/src/playwrightAdapter.ts`
  - Create metadata writer/recorder during start.
  - Emit `capture_started` and `capture_stopped`.
  - Return metadata path in `CaptureOutput`.
  - Close metadata resources on setup/stop failures.
- Modify: `packages/capture/src/playwrightAdapter.test.ts`
  - Update fake Playwright objects for the new seam.
  - Verify metadata output and stop failure behavior.
- Modify: `packages/capture/src/index.test.ts`
  - Update `CaptureOutput` sample to include metadata.
- Modify: `packages/capture/src/playwrightAdapter.smoke.test.ts`
  - Verify real capture writes parseable `metadata/events.jsonl`.
- Modify: `packages/capture/package.json`
  - Include new unit test files in `test` script.
- Modify: `packages/cli/src/index.test.ts`
  - Update fake capture outputs to include metadata.
- Modify: `README.md`
  - Update early capture-runtime status to mention metadata JSONL after implementation.

## Task 1: Capture Paths And Public Output Contract

**Files:**

- Modify: `packages/capture/src/capturePaths.test.ts`
- Modify: `packages/capture/src/capturePaths.ts`
- Modify: `packages/capture/src/index.test.ts`
- Modify: `packages/capture/src/index.ts`

- [ ] **Step 1: Write failing path tests**

Replace `packages/capture/src/capturePaths.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { buildCapturePaths } from "./capturePaths.js";

describe("buildCapturePaths", () => {
  it("builds media, metadata, and manifest paths from an output directory", () => {
    expect(buildCapturePaths("demo-capture///")).toEqual({
      outputDir: "demo-capture",
      manifestPath: "demo-capture/capture.manifest.json",
      mediaDir: "demo-capture/media",
      viewportMediaPath: "demo-capture/media/viewport.webm",
      metadataDir: "demo-capture/metadata",
      eventsPath: "demo-capture/metadata/events.jsonl",
    });
  });

  it("preserves the filesystem root as a valid output directory", () => {
    expect(buildCapturePaths("/")).toEqual({
      outputDir: "/",
      manifestPath: "/capture.manifest.json",
      mediaDir: "/media",
      viewportMediaPath: "/media/viewport.webm",
      metadataDir: "/metadata",
      eventsPath: "/metadata/events.jsonl",
    });
  });

  it("rejects an empty output directory", () => {
    expect(() => buildCapturePaths("///")).not.toThrow();
    expect(() => buildCapturePaths("")).toThrow("Capture output directory is required.");
  });
});
```

- [ ] **Step 2: Write failing public output type test**

Update the `CaptureOutput` test in `packages/capture/src/index.test.ts` so the sample output includes metadata:

```ts
describe("CaptureOutput", () => {
  it("represents media, metadata, and timing returned by a successful capture", () => {
    const output: CaptureOutput = {
      outputDir: "demo-capture",
      manifestPath: "demo-capture/capture.manifest.json",
      media: {
        kind: "viewport",
        path: "demo-capture/media/viewport.webm",
        contentType: "video/webm",
      },
      metadata: {
        kind: "events",
        path: "demo-capture/metadata/events.jsonl",
        contentType: "application/x-ndjson",
      },
      timing: {
        startedAt: "2026-06-28T12:00:00.000Z",
        endedAt: "2026-06-28T12:00:03.250Z",
        durationMs: 3250,
      },
    };

    expect(output.media.path).toBe("demo-capture/media/viewport.webm");
    expect(output.metadata.path).toBe("demo-capture/metadata/events.jsonl");
    expect(output.timing.durationMs).toBe(3250);
  });
});
```

- [ ] **Step 3: Run failing capture tests**

Run:

```bash
npm --workspace @auto-demo/capture test -- src/index.test.ts src/capturePaths.test.ts
```

Expected: FAIL because `metadataDir`, `eventsPath`, and `CaptureOutput.metadata` do not exist yet.

- [ ] **Step 4: Implement path and type changes**

Update `packages/capture/src/capturePaths.ts`:

```ts
import { mkdir } from "node:fs/promises";

export type CapturePaths = {
  outputDir: string;
  manifestPath: string;
  mediaDir: string;
  viewportMediaPath: string;
  metadataDir: string;
  eventsPath: string;
};

export function buildCapturePaths(outputDir: string): CapturePaths {
  const normalizedOutputDir = trimTrailingSlashes(outputDir);
  if (normalizedOutputDir.length === 0) {
    throw new Error("Capture output directory is required.");
  }

  const mediaDir = appendPathSegment(normalizedOutputDir, "media");
  const metadataDir = appendPathSegment(normalizedOutputDir, "metadata");

  return {
    outputDir: normalizedOutputDir,
    manifestPath: appendPathSegment(normalizedOutputDir, "capture.manifest.json"),
    mediaDir,
    viewportMediaPath: appendPathSegment(mediaDir, "viewport.webm"),
    metadataDir,
    eventsPath: appendPathSegment(metadataDir, "events.jsonl"),
  };
}

export async function ensureCaptureDirectories(paths: CapturePaths): Promise<void> {
  await Promise.all([
    mkdir(paths.mediaDir, { recursive: true }),
    mkdir(paths.metadataDir, { recursive: true }),
  ]);
}

function trimTrailingSlashes(value: string): string {
  if (/^\/+$/.test(value)) {
    return "/";
  }

  return value.replace(/\/+$/, "");
}

function appendPathSegment(base: string, segment: string): string {
  return base === "/" ? `/${segment}` : `${base}/${segment}`;
}
```

Update `packages/capture/src/index.ts` around the capture artifact types:

```ts
export type CaptureMediaArtifact = {
  kind: "viewport";
  path: string;
  contentType: "video/webm";
};

export type CaptureMetadataArtifact = {
  kind: "events";
  path: string;
  contentType: "application/x-ndjson";
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
  metadata: CaptureMetadataArtifact;
  timing: CaptureTiming;
};
```

- [ ] **Step 5: Run path and public contract tests**

Run:

```bash
npm --workspace @auto-demo/capture test -- src/index.test.ts src/capturePaths.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/capture/src/capturePaths.ts packages/capture/src/capturePaths.test.ts packages/capture/src/index.ts packages/capture/src/index.test.ts
git commit -m "feat: add capture metadata artifact contract"
```

## Task 2: Event Model, Redaction, And JSONL Writer

**Files:**

- Create: `packages/capture/src/captureEvents.ts`
- Create: `packages/capture/src/captureEvents.test.ts`
- Create: `packages/capture/src/jsonlEventWriter.ts`
- Create: `packages/capture/src/jsonlEventWriter.test.ts`
- Modify: `packages/capture/package.json`

- [ ] **Step 1: Write failing event model tests**

Create `packages/capture/src/captureEvents.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifyCapturedValue,
  createCaptureEventFactory,
  redactCapturedValue,
  type CaptureEvent,
} from "./captureEvents.js";

describe("createCaptureEventFactory", () => {
  it("creates ordered events with timestamps relative to capture start", () => {
    const factory = createCaptureEventFactory({
      captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
      now: (() => {
        const dates = [new Date("2026-06-29T12:00:00.000Z"), new Date("2026-06-29T12:00:01.250Z")];
        return () => dates.shift() ?? new Date("2026-06-29T12:00:01.250Z");
      })(),
    });

    const first = factory.create("capture_started", {
      pageUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
    });
    const second = factory.create("navigation", {
      pageUrl: "https://example.com/dashboard",
      data: { phase: "load" },
    });

    expect(first).toMatchObject({
      id: "event-1",
      sequence: 1,
      type: "capture_started",
      timestampMs: 0,
      pageUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
    } satisfies Partial<CaptureEvent>);
    expect(second).toMatchObject({
      id: "event-2",
      sequence: 2,
      type: "navigation",
      timestampMs: 1250,
      pageUrl: "https://example.com/dashboard",
      data: { phase: "load" },
    } satisfies Partial<CaptureEvent>);
  });
});

describe("classifyCapturedValue", () => {
  it.each([
    ["person@example.com", "email_like"],
    ["https://example.com/path", "url_like"],
    ["12345.67", "number_like"],
    ["hello", "short_text"],
    ["x".repeat(81), "long_text"],
    ["", "unknown"],
  ] as const)("classifies %s as %s", (value, expected) => {
    expect(classifyCapturedValue({ value, inputType: "text" })).toBe(expected);
  });

  it("treats password fields as password regardless of value shape", () => {
    expect(classifyCapturedValue({ value: "person@example.com", inputType: "password" })).toBe(
      "password",
    );
  });
});

describe("redactCapturedValue", () => {
  it("redacts typed values while keeping useful coarse metadata", () => {
    expect(redactCapturedValue({ value: "person@example.com", inputType: "email" })).toEqual({
      redacted: true,
      valueKind: "email_like",
      valueLength: 18,
    });
  });

  it("omits exact password length", () => {
    expect(redactCapturedValue({ value: "secret-password", inputType: "password" })).toEqual({
      redacted: true,
      valueKind: "password",
    });
  });
});
```

- [ ] **Step 2: Write failing JSONL writer tests**

Create `packages/capture/src/jsonlEventWriter.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCaptureEventFactory } from "./captureEvents.js";
import { createJsonlEventWriter } from "./jsonlEventWriter.js";

describe("createJsonlEventWriter", () => {
  it("writes independently parseable JSON lines", async () => {
    const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-events-writer-"));
    const eventsPath = join(outputDir, "events.jsonl");
    const writer = await createJsonlEventWriter(eventsPath);
    const factory = createCaptureEventFactory({
      captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
      now: () => new Date("2026-06-29T12:00:00.500Z"),
    });

    await writer.write(factory.create("capture_started", { pageUrl: "https://example.com" }));
    await writer.write(factory.create("capture_stopped", { data: { reason: "completed" } }));
    await writer.close();

    const lines = (await readFile(eventsPath, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ sequence: 1, type: "capture_started" }),
      expect.objectContaining({ sequence: 2, type: "capture_stopped" }),
    ]);
  });
});
```

- [ ] **Step 3: Run failing event tests**

Run:

```bash
npm --workspace @auto-demo/capture test -- src/captureEvents.test.ts src/jsonlEventWriter.test.ts
```

Expected: FAIL because `captureEvents.ts` and `jsonlEventWriter.ts` do not exist.

- [ ] **Step 4: Implement event model and redaction**

Create `packages/capture/src/captureEvents.ts`:

```ts
export type CaptureEventType =
  | "capture_started"
  | "capture_stopped"
  | "navigation"
  | "click"
  | "fill"
  | "press"
  | "viewport"
  | "console"
  | "page_error"
  | "agent_step";

export type CaptureEvent = {
  id: string;
  sequence: number;
  type: CaptureEventType;
  timestampMs: number;
  pageUrl?: string;
  pageTitle?: string;
  viewport?: {
    width: number;
    height: number;
  };
  data?: Record<string, unknown>;
};

export type CapturedValueKind =
  "email_like" | "url_like" | "number_like" | "short_text" | "long_text" | "password" | "unknown";

export type CapturedValueInput = {
  value: string | undefined;
  inputType: string | undefined;
};

export type RedactedCapturedValue = {
  redacted: true;
  valueKind: CapturedValueKind;
  valueLength?: number;
};

export type CaptureTargetHint = {
  tagName?: string;
  inputType?: string;
  role?: string;
  label?: string;
  text?: string;
  selector?: string;
};

export type CaptureEventFactory = {
  create(
    type: CaptureEventType,
    fields?: Omit<CaptureEvent, "id" | "sequence" | "type" | "timestampMs">,
  ): CaptureEvent;
};

export function createCaptureEventFactory(options: {
  captureStartedAt: Date;
  now: () => Date;
}): CaptureEventFactory {
  let sequence = 0;

  return {
    create(type, fields = {}) {
      sequence += 1;
      return {
        id: `event-${sequence}`,
        sequence,
        type,
        timestampMs: Math.max(0, options.now().getTime() - options.captureStartedAt.getTime()),
        ...fields,
      };
    },
  };
}

export function redactCapturedValue(input: CapturedValueInput): RedactedCapturedValue {
  const valueKind = classifyCapturedValue(input);
  if (valueKind === "password") {
    return { redacted: true, valueKind };
  }

  return {
    redacted: true,
    valueKind,
    valueLength: input.value?.length ?? 0,
  };
}

export function classifyCapturedValue(input: CapturedValueInput): CapturedValueKind {
  const inputType = input.inputType?.toLowerCase();
  const value = input.value ?? "";

  if (inputType === "password") {
    return "password";
  }

  if (value.length === 0) {
    return "unknown";
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "email_like";
  }

  if (/^https?:\/\/\S+$/i.test(value)) {
    return "url_like";
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return "number_like";
  }

  return value.length > 80 ? "long_text" : "short_text";
}
```

- [ ] **Step 5: Implement JSONL writer**

Create `packages/capture/src/jsonlEventWriter.ts`:

```ts
import { open, type FileHandle } from "node:fs/promises";
import type { CaptureEvent } from "./captureEvents.js";

export type JsonlEventWriter = {
  write(event: CaptureEvent): Promise<void>;
  close(): Promise<void>;
};

export async function createJsonlEventWriter(eventsPath: string): Promise<JsonlEventWriter> {
  const file = await open(eventsPath, "w");
  return new FileHandleJsonlEventWriter(file);
}

class FileHandleJsonlEventWriter implements JsonlEventWriter {
  private closed = false;

  constructor(private readonly file: FileHandle) {}

  async write(event: CaptureEvent): Promise<void> {
    if (this.closed) {
      throw new Error("Cannot write to a closed capture event writer.");
    }

    await this.file.appendFile(`${JSON.stringify(event)}\n`, "utf8");
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    this.closed = true;
    await this.file.close();
  }
}
```

- [ ] **Step 6: Add new tests to capture package script**

Modify `packages/capture/package.json`:

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run src/index.test.ts src/capturePaths.test.ts src/captureEvents.test.ts src/jsonlEventWriter.test.ts src/playwrightMetadataRecorder.test.ts src/playwrightAdapter.test.ts",
    "test:smoke": "vitest run src/*.smoke.test.ts",
    "setup:browser": "playwright install chromium"
  }
}
```

Keep the existing package metadata, dependency block, and other fields unchanged.

- [ ] **Step 7: Run event tests**

Run:

```bash
npm --workspace @auto-demo/capture test -- src/captureEvents.test.ts src/jsonlEventWriter.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/capture/package.json packages/capture/src/captureEvents.ts packages/capture/src/captureEvents.test.ts packages/capture/src/jsonlEventWriter.ts packages/capture/src/jsonlEventWriter.test.ts
git commit -m "feat: add capture event model and jsonl writer"
```

## Task 3: Playwright Driver Seam And Metadata Recorder

**Files:**

- Modify: `packages/capture/src/playwrightDriver.ts`
- Create: `packages/capture/src/playwrightMetadataRecorder.ts`
- Create: `packages/capture/src/playwrightMetadataRecorder.test.ts`

- [ ] **Step 1: Write failing metadata recorder tests**

Create `packages/capture/src/playwrightMetadataRecorder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createCaptureEventFactory, type CaptureEvent } from "./captureEvents.js";
import { createPlaywrightMetadataRecorder } from "./playwrightMetadataRecorder.js";
import type {
  BrowserBindingCallback,
  PlaywrightConsoleMessage,
  PlaywrightPage,
  PlaywrightPageError,
} from "./playwrightDriver.js";

class MemoryWriter {
  public readonly events: CaptureEvent[] = [];
  public closed = false;

  async write(event: CaptureEvent): Promise<void> {
    this.events.push(event);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakePage implements PlaywrightPage {
  public readonly gotos: string[] = [];
  public readonly initScripts: string[] = [];
  public binding: BrowserBindingCallback | undefined;
  public consoleHandler: ((message: PlaywrightConsoleMessage) => void) | undefined;
  public pageErrorHandler: ((error: PlaywrightPageError) => void) | undefined;
  public currentUrl = "https://example.com";
  public currentTitle = "Example";
  public viewport = { width: 1280, height: 720 };

  async goto(url: string): Promise<void> {
    this.gotos.push(url);
    this.currentUrl = url;
  }

  video(): null {
    return null;
  }

  async exposeBinding(_name: string, callback: BrowserBindingCallback): Promise<void> {
    this.binding = callback;
  }

  async addInitScript(script: string): Promise<void> {
    this.initScripts.push(script);
  }

  onConsole(callback: (message: PlaywrightConsoleMessage) => void): void {
    this.consoleHandler = callback;
  }

  onPageError(callback: (error: PlaywrightPageError) => void): void {
    this.pageErrorHandler = callback;
  }

  async snapshotMetadata() {
    return {
      pageUrl: this.currentUrl,
      pageTitle: this.currentTitle,
      viewport: this.viewport,
    };
  }
}

describe("createPlaywrightMetadataRecorder", () => {
  it("records browser-side interaction events with redacted fill values", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    const recorder = await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:01.000Z"),
      }),
    });

    expect(page.initScripts).toHaveLength(1);
    expect(page.binding).toBeDefined();

    await page.binding?.({
      type: "fill",
      pageUrl: "https://example.com/settings",
      pageTitle: "Settings",
      viewport: { width: 1280, height: 720 },
      data: {
        target: { tagName: "INPUT", inputType: "email", label: "Email" },
        value: "person@example.com",
        inputType: "email",
        inputMethod: "keyboard",
      },
    });

    await recorder.close();

    expect(writer.events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "fill",
        timestampMs: 1000,
        pageUrl: "https://example.com/settings",
        pageTitle: "Settings",
        viewport: { width: 1280, height: 720 },
        data: {
          target: { tagName: "INPUT", inputType: "email", label: "Email" },
          inputMethod: "keyboard",
          redacted: true,
          valueKind: "email_like",
          valueLength: 18,
        },
      }),
    ]);
    expect(writer.closed).toBe(true);
  });

  it("records console and page error summaries", async () => {
    const page = new FakePage();
    const writer = new MemoryWriter();
    await createPlaywrightMetadataRecorder({
      page,
      writer,
      eventFactory: createCaptureEventFactory({
        captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
        now: () => new Date("2026-06-29T12:00:00.250Z"),
      }),
    });

    page.consoleHandler?.({
      type: "warning",
      text: "Something useful happened",
      location: { url: "https://example.com/app.js", lineNumber: 10, columnNumber: 2 },
    });
    page.pageErrorHandler?.({
      name: "Error",
      message: "Render failed",
      stack: "Error: Render failed\n    at render (app.js:10:2)",
    });

    expect(writer.events).toEqual([
      expect.objectContaining({
        sequence: 1,
        type: "console",
        data: {
          level: "warning",
          text: "Something useful happened",
          location: { url: "https://example.com/app.js", lineNumber: 10, columnNumber: 2 },
        },
      }),
      expect.objectContaining({
        sequence: 2,
        type: "page_error",
        data: {
          name: "Error",
          message: "Render failed",
          stackSummary: "Error: Render failed",
        },
      }),
    ]);
  });
});
```

- [ ] **Step 2: Run failing recorder tests**

Run:

```bash
npm --workspace @auto-demo/capture test -- src/playwrightMetadataRecorder.test.ts
```

Expected: FAIL because the recorder and new driver seam types do not exist.

- [ ] **Step 3: Extend internal Playwright driver seam**

Modify `packages/capture/src/playwrightDriver.ts` to include these types and page methods while preserving current launch/context/video behavior:

```ts
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Video,
} from "playwright";
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
    size: CaptureViewport;
  };
};

export type PlaywrightBrowserContext = {
  newPage(): Promise<PlaywrightPage>;
  close(): Promise<void>;
};

export type BrowserBindingPayload = {
  type: "click" | "fill" | "press" | "viewport" | "navigation";
  pageUrl?: string;
  pageTitle?: string;
  viewport?: CaptureViewport;
  data?: Record<string, unknown>;
};

export type BrowserBindingCallback = (payload: BrowserBindingPayload) => Promise<void> | void;

export type PlaywrightConsoleMessage = {
  type: string;
  text: string;
  location?: {
    url: string;
    lineNumber: number;
    columnNumber: number;
  };
};

export type PlaywrightPageError = {
  name?: string;
  message: string;
  stack?: string;
};

export type PlaywrightPageSnapshot = {
  pageUrl?: string;
  pageTitle?: string;
  viewport?: CaptureViewport;
};

export type PlaywrightPage = {
  goto(url: string): Promise<void>;
  video(): PlaywrightVideo | null;
  exposeBinding(name: string, callback: BrowserBindingCallback): Promise<void>;
  addInitScript(script: string): Promise<void>;
  onConsole(callback: (message: PlaywrightConsoleMessage) => void): void;
  onPageError(callback: (error: PlaywrightPageError) => void): void;
  snapshotMetadata(): Promise<PlaywrightPageSnapshot>;
};

export type PlaywrightVideo = {
  path(): Promise<string>;
};
```

Update `wrapPage(page: Page)` in the same file:

```ts
function wrapPage(page: Page): PlaywrightPage {
  return {
    async goto(url) {
      await page.goto(url);
    },
    video() {
      const video = page.video();
      return video === null ? null : wrapVideo(video);
    },
    async exposeBinding(name, callback) {
      await page.exposeBinding(name, async (_source, payload) => {
        await callback(payload);
      });
    },
    async addInitScript(script) {
      await page.addInitScript(script);
    },
    onConsole(callback) {
      page.on("console", (message: ConsoleMessage) => {
        callback({
          type: message.type(),
          text: message.text(),
          location: message.location(),
        });
      });
    },
    onPageError(callback) {
      page.on("pageerror", (error) => {
        callback({
          name: error.name,
          message: error.message,
          stack: error.stack,
        });
      });
    },
    async snapshotMetadata() {
      const viewport = page.viewportSize() ?? undefined;
      return {
        pageUrl: page.url(),
        pageTitle: await page.title().catch(() => undefined),
        viewport:
          viewport === undefined ? undefined : { width: viewport.width, height: viewport.height },
      };
    },
  };
}
```

- [ ] **Step 4: Implement metadata recorder**

Create `packages/capture/src/playwrightMetadataRecorder.ts`:

```ts
import {
  redactCapturedValue,
  type CaptureEventFactory,
  type CaptureEventType,
} from "./captureEvents.js";
import type { JsonlEventWriter } from "./jsonlEventWriter.js";
import type {
  BrowserBindingPayload,
  PlaywrightConsoleMessage,
  PlaywrightPage,
  PlaywrightPageError,
} from "./playwrightDriver.js";

const BINDING_NAME = "__autoDemoCaptureEvent";

export type PlaywrightMetadataRecorder = {
  writeCaptureStarted(data: Record<string, unknown>): Promise<void>;
  writeCaptureStopped(data: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
};

export async function createPlaywrightMetadataRecorder(options: {
  page: PlaywrightPage;
  writer: JsonlEventWriter;
  eventFactory: CaptureEventFactory;
}): Promise<PlaywrightMetadataRecorder> {
  const recorder = new DefaultPlaywrightMetadataRecorder(
    options.page,
    options.writer,
    options.eventFactory,
  );
  await recorder.attach();
  return recorder;
}

class DefaultPlaywrightMetadataRecorder implements PlaywrightMetadataRecorder {
  constructor(
    private readonly page: PlaywrightPage,
    private readonly writer: JsonlEventWriter,
    private readonly eventFactory: CaptureEventFactory,
  ) {}

  async attach(): Promise<void> {
    await this.page.exposeBinding(BINDING_NAME, async (payload) => {
      await this.writeBrowserPayload(payload);
    });
    await this.page.addInitScript(browserInstrumentationScript(BINDING_NAME));
    this.page.onConsole((message) => {
      void this.writeConsole(message);
    });
    this.page.onPageError((error) => {
      void this.writePageError(error);
    });
  }

  async writeCaptureStarted(data: Record<string, unknown>): Promise<void> {
    const snapshot = await this.page.snapshotMetadata();
    await this.writer.write(
      this.eventFactory.create("capture_started", {
        ...snapshot,
        data,
      }),
    );
  }

  async writeCaptureStopped(data: Record<string, unknown>): Promise<void> {
    const snapshot = await this.page.snapshotMetadata();
    await this.writer.write(
      this.eventFactory.create("capture_stopped", {
        ...snapshot,
        data,
      }),
    );
  }

  async close(): Promise<void> {
    await this.writer.close();
  }

  private async writeBrowserPayload(payload: BrowserBindingPayload): Promise<void> {
    const type = payload.type;
    const data = normalizeBrowserPayloadData(payload);
    await this.writer.write(
      this.eventFactory.create(type, {
        pageUrl: payload.pageUrl,
        pageTitle: payload.pageTitle,
        viewport: payload.viewport,
        data,
      }),
    );
  }

  private async writeConsole(message: PlaywrightConsoleMessage): Promise<void> {
    const snapshot = await this.page.snapshotMetadata();
    await this.writer.write(
      this.eventFactory.create("console", {
        ...snapshot,
        data: {
          level: message.type,
          text: truncateText(message.text, 500),
          location: message.location,
        },
      }),
    );
  }

  private async writePageError(error: PlaywrightPageError): Promise<void> {
    const snapshot = await this.page.snapshotMetadata();
    await this.writer.write(
      this.eventFactory.create("page_error", {
        ...snapshot,
        data: {
          name: error.name,
          message: truncateText(error.message, 500),
          stackSummary: error.stack?.split("\n")[0],
        },
      }),
    );
  }
}

function normalizeBrowserPayloadData(
  payload: BrowserBindingPayload,
): Record<string, unknown> | undefined {
  if (payload.type !== "fill") {
    return payload.data;
  }

  const value = typeof payload.data?.value === "string" ? payload.data.value : undefined;
  const inputType =
    typeof payload.data?.inputType === "string" ? payload.data.inputType : undefined;
  const { value: _value, inputType: _inputType, ...rest } = payload.data ?? {};
  return {
    ...rest,
    ...redactCapturedValue({ value, inputType }),
  };
}

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function browserInstrumentationScript(bindingName: string): string {
  return `
(() => {
  const send = (payload) => {
    const binding = window["${bindingName}"];
    if (typeof binding === "function") {
      void binding(payload);
    }
  };
  const targetHint = (target) => {
    if (!(target instanceof Element)) return undefined;
    const text = (target.textContent || "").trim().slice(0, 120) || undefined;
    const label = target.getAttribute("aria-label") || undefined;
    const role = target.getAttribute("role") || undefined;
    const tagName = target.tagName;
    const inputType = target instanceof HTMLInputElement ? target.type : undefined;
    return { tagName, inputType, role, label, text };
  };
  const pageFields = () => ({
    pageUrl: window.location.href,
    pageTitle: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  });
  document.addEventListener("click", (event) => {
    send({
      type: "click",
      ...pageFields(),
      data: {
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
        target: targetHint(event.target)
      }
    });
  }, true);
  document.addEventListener("keydown", (event) => {
    send({
      type: "press",
      ...pageFields(),
      data: {
        key: event.key,
        modifiers: { alt: event.altKey, ctrl: event.ctrlKey, meta: event.metaKey, shift: event.shiftKey },
        target: targetHint(event.target)
      }
    });
  }, true);
  document.addEventListener("input", (event) => {
    const target = event.target;
    const value = target && "value" in target ? String(target.value) : undefined;
    const inputType = target instanceof HTMLInputElement ? target.type : undefined;
    send({
      type: "fill",
      ...pageFields(),
      data: {
        target: targetHint(target),
        value,
        inputType,
        inputMethod: event.inputType || "input"
      }
    });
  }, true);
  window.addEventListener("resize", () => {
    send({ type: "viewport", ...pageFields(), data: { width: window.innerWidth, height: window.innerHeight } });
  });
})();
`;
}
```

- [ ] **Step 5: Run recorder tests**

Run:

```bash
npm --workspace @auto-demo/capture test -- src/playwrightMetadataRecorder.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/capture/src/playwrightDriver.ts packages/capture/src/playwrightMetadataRecorder.ts packages/capture/src/playwrightMetadataRecorder.test.ts
git commit -m "feat: record browser metadata events"
```

## Task 4: Integrate Metadata Into Playwright Capture Session

**Files:**

- Modify: `packages/capture/src/playwrightAdapter.test.ts`
- Modify: `packages/capture/src/playwrightAdapter.ts`

- [ ] **Step 1: Update fake Playwright classes in adapter tests**

At the top of `packages/capture/src/playwrightAdapter.test.ts`, update imports:

```ts
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
```

Then update `FakePage` to implement the extended `PlaywrightPage` seam:

```ts
class FakePage implements PlaywrightPage {
  public readonly gotos: string[] = [];
  public readonly initScripts: string[] = [];
  public currentUrl = "https://example.com/demo";
  public currentTitle = "Demo";
  public viewport = { width: 1280, height: 720 };

  constructor(private readonly fakeVideo: PlaywrightVideo | null) {}

  async goto(url: string): Promise<void> {
    this.gotos.push(url);
    this.currentUrl = url;
  }

  video(): PlaywrightVideo | null {
    return this.fakeVideo;
  }

  async exposeBinding(): Promise<void> {}

  async addInitScript(script: string): Promise<void> {
    this.initScripts.push(script);
  }

  onConsole(): void {}

  onPageError(): void {}

  async snapshotMetadata() {
    return {
      pageUrl: this.currentUrl,
      pageTitle: this.currentTitle,
      viewport: this.viewport,
    };
  }
}
```

- [ ] **Step 2: Write failing adapter metadata output test**

Add this test to `packages/capture/src/playwrightAdapter.test.ts`:

```ts
it("returns metadata path and writes capture lifecycle events when the session stops", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-metadata-"));
  const driver = new FakeDriver(join(outputDir, "media", "raw.webm"));
  const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
    now: (() => {
      const dates = [
        new Date("2026-06-29T12:00:00.000Z"),
        new Date("2026-06-29T12:00:00.000Z"),
        new Date("2026-06-29T12:00:02.500Z"),
        new Date("2026-06-29T12:00:02.500Z"),
      ];
      return () => dates.shift() ?? new Date("2026-06-29T12:00:02.500Z");
    })(),
  });

  const startResult = await adapter.start({
    source: { kind: "browser", url: "https://example.com/demo" },
    outputDir,
    viewport: { width: 1280, height: 720 },
    startedAt: "2026-06-29T11:59:59.000Z",
    childCommand: { command: "npm", args: ["run", "walkthrough"] },
  });

  expect(startResult.ok).toBe(true);
  if (!startResult.ok) {
    return;
  }

  const stopResult = await startResult.session.stop("completed");

  expect(stopResult.ok).toBe(true);
  if (!stopResult.ok) {
    return;
  }

  expect(stopResult.output.metadata).toEqual({
    kind: "events",
    path: `${outputDir}/metadata/events.jsonl`,
    contentType: "application/x-ndjson",
  });

  const events = (await readFile(stopResult.output.metadata.path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events).toEqual([
    expect.objectContaining({
      sequence: 1,
      type: "capture_started",
      timestampMs: 0,
      data: {
        sourceUrl: "https://example.com/demo",
        viewport: { width: 1280, height: 720 },
        childCommand: { command: "npm", args: ["run", "walkthrough"] },
      },
    }),
    expect.objectContaining({
      sequence: 2,
      type: "capture_stopped",
      timestampMs: 2500,
      data: { reason: "completed", durationMs: 2500 },
    }),
  ]);
});
```

- [ ] **Step 3: Write failing stop failure test for metadata close errors**

Add this test to `packages/capture/src/playwrightAdapter.test.ts`:

```ts
it("returns stop failure when metadata cannot be flushed", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "auto-demo-playwright-metadata-stop-failure-"));
  const videoPath = join(outputDir, "media", "raw.webm");
  await mkdir(join(outputDir, "media"), { recursive: true });
  await writeFile(videoPath, "video");
  const driver = new FakeDriver(videoPath);
  const adapter = createPlaywrightBrowserCaptureAdapterForDriver(driver, {
    now: () => new Date("2026-06-29T12:00:00.000Z"),
  });

  const startResult = await adapter.start({
    source: { kind: "browser", url: "https://example.com/demo" },
    outputDir,
    viewport: { width: 1280, height: 720 },
    startedAt: "2026-06-29T12:00:00.000Z",
  });

  expect(startResult.ok).toBe(true);
  if (!startResult.ok) {
    return;
  }

  await writeFile(`${outputDir}/metadata/events.jsonl`, "not writable");
  await mkdir(`${outputDir}/metadata/events.jsonl/blocker`, { recursive: true });

  const stopResult = await startResult.session.stop("completed");

  expect(stopResult).toEqual({
    ok: false,
    code: "capture_stop_failed",
    message: "Browser capture stop failed.",
    outputDir,
    manifestPath: `${outputDir}/capture.manifest.json`,
  });
});
```

If this test is too filesystem-dependent on the current platform, replace it with an injected writer seam in `playwrightAdapter.ts` and a fake writer that throws on `close()`. Keep the observable expectation exactly the same.

- [ ] **Step 4: Run failing adapter tests**

Run:

```bash
npm --workspace @auto-demo/capture test -- src/playwrightAdapter.test.ts
```

Expected: FAIL because the adapter does not create a metadata recorder or include metadata in output.

- [ ] **Step 5: Integrate metadata recorder in adapter start**

Update imports in `packages/capture/src/playwrightAdapter.ts`:

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
import { createCaptureEventFactory, type CaptureEventFactory } from "./captureEvents.js";
import { buildCapturePaths, ensureCaptureDirectories, type CapturePaths } from "./capturePaths.js";
import { createJsonlEventWriter } from "./jsonlEventWriter.js";
import {
  createPlaywrightMetadataRecorder,
  type PlaywrightMetadataRecorder,
} from "./playwrightMetadataRecorder.js";
import {
  createDefaultPlaywrightDriver,
  type PlaywrightBrowser,
  type PlaywrightBrowserContext,
  type PlaywrightDriver,
  type PlaywrightPage,
} from "./playwrightDriver.js";
```

In `startPlaywrightCapture`, after `const page = await context.newPage();`, create the event factory and recorder before navigation:

```ts
const page = await context.newPage();
const captureStartedAt = dependencies.now();
const eventFactory = createCaptureEventFactory({
  captureStartedAt,
  now: dependencies.now,
});
const writer = await createJsonlEventWriter(paths.eventsPath);
const metadataRecorder = await createPlaywrightMetadataRecorder({
  page,
  writer,
  eventFactory,
});
await metadataRecorder.writeCaptureStarted({
  sourceUrl: options.source.url,
  viewport: options.viewport,
  childCommand: options.childCommand,
});
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
    startedAt: captureStartedAt,
    now: dependencies.now,
    metadataRecorder,
    eventFactory,
  }),
};
```

Add `metadataRecorder` to `PlaywrightCaptureSession` state:

```ts
metadataRecorder: PlaywrightMetadataRecorder;
eventFactory: CaptureEventFactory;
```

- [ ] **Step 6: Return metadata in stop result**

Update `stopOnce()` in `packages/capture/src/playwrightAdapter.ts` so it writes the stopped event and includes metadata:

```ts
  private async stopOnce(reason: CaptureStopReason): Promise<CaptureStopResult> {
    const video = this.state.page.video();
    try {
      const endedAt = this.state.now();
      await this.state.metadataRecorder.writeCaptureStopped({
        reason,
        durationMs: endedAt.getTime() - this.state.startedAt.getTime(),
      });
      await this.state.metadataRecorder.close();
      await this.state.context.close();
      await this.state.browser.close();
      if (video === null) {
        return this.stopFailed();
      }

      const generatedPath = await video.path();
      const mediaPath = await moveViewportVideo(generatedPath, this.state.paths.viewportMediaPath);
      const output: CaptureOutput = {
        outputDir: this.state.paths.outputDir,
        manifestPath: this.state.paths.manifestPath,
        media: {
          kind: "viewport",
          path: mediaPath,
          contentType: "video/webm",
        },
        metadata: {
          kind: "events",
          path: this.state.paths.eventsPath,
          contentType: "application/x-ndjson",
        },
        timing: {
          startedAt: this.state.startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          durationMs: endedAt.getTime() - this.state.startedAt.getTime(),
        },
      };
      return { ok: true, output };
    } catch {
      await closeMetadataQuietly(this.state.metadataRecorder);
      await closeQuietly(this.state.browser);
      return this.stopFailed();
    }
  }
```

Update `stop()` to pass the reason:

```ts
  async stop(reason: CaptureStopReason): Promise<CaptureStopResult> {
    if (this.stopPromise !== undefined) {
      return await this.stopPromise;
    }

    this.stopPromise = this.stopOnce(reason);
    return await this.stopPromise;
  }
```

Add helper:

```ts
async function closeMetadataQuietly(
  recorder: PlaywrightMetadataRecorder | undefined,
): Promise<void> {
  try {
    await recorder?.close();
  } catch {
    // Preserve the original setup or stop failure.
  }
}
```

- [ ] **Step 7: Close metadata on setup failure**

In `startPlaywrightCapture`, declare `let metadataRecorder: PlaywrightMetadataRecorder | undefined;` beside `browser` and `context`, assign it when created, and update the `catch` block:

```ts
  } catch {
    await closeMetadataQuietly(metadataRecorder);
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
```

- [ ] **Step 8: Run adapter tests**

Run:

```bash
npm --workspace @auto-demo/capture test -- src/playwrightAdapter.test.ts
```

Expected: PASS. If the metadata close failure test is unstable because the OS allows the file operation, convert the adapter to accept an internal writer factory dependency and use a throwing fake writer in the test.

- [ ] **Step 9: Commit**

```bash
git add packages/capture/src/playwrightAdapter.ts packages/capture/src/playwrightAdapter.test.ts
git commit -m "feat: write metadata during playwright capture"
```

## Task 5: CLI Fixtures, Smoke Test, And Docs

**Files:**

- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/capture/src/playwrightAdapter.smoke.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Update CLI fake output fixture**

Modify `fakeCaptureOutput()` in `packages/cli/src/index.test.ts`:

```ts
function fakeCaptureOutput(outputDir: string): CaptureOutput {
  return {
    outputDir,
    manifestPath: `${outputDir}/capture.manifest.json`,
    media: {
      kind: "viewport",
      path: `${outputDir}/media/viewport.webm`,
      contentType: "video/webm",
    },
    metadata: {
      kind: "events",
      path: `${outputDir}/metadata/events.jsonl`,
      contentType: "application/x-ndjson",
    },
    timing: {
      startedAt: "2026-06-28T12:00:00.000Z",
      endedAt: "2026-06-28T12:00:02.500Z",
      durationMs: 2500,
    },
  };
}
```

- [ ] **Step 2: Run CLI tests**

Run:

```bash
npm --workspace @auto-demo/cli test
```

Expected: PASS with unchanged CLI stdout behavior.

- [ ] **Step 3: Update smoke test to verify metadata JSONL**

Modify imports in `packages/capture/src/playwrightAdapter.smoke.test.ts`:

```ts
import { createServer } from "node:http";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
```

Inside the served HTML body, replace the button with one that produces interaction events:

```html
<button id="record-button">Record me</button>
<input aria-label="Email" type="email" />
<script>
  window.addEventListener("load", () => {
    document.querySelector("button").click();
    const input = document.querySelector("input");
    input.value = "person@example.com";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    console.warn("smoke warning");
  });
</script>
```

After the existing media assertions, add:

```ts
const metadataText = await readFile(stop.output.metadata.path, "utf8");
const events = metadataText
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));
expect(events.length).toBeGreaterThanOrEqual(3);
expect(events).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ type: "capture_started" }),
    expect.objectContaining({ type: "capture_stopped" }),
  ]),
);
expect(metadataText).not.toContain("person@example.com");
```

- [ ] **Step 4: Run smoke test**

Run:

```bash
npm --workspace @auto-demo/capture run test:smoke
```

Expected: PASS. If Chromium is not installed, run `npm --workspace @auto-demo/capture run setup:browser` once, then rerun the smoke test.

- [ ] **Step 5: Update README status**

In `README.md`, update the early status paragraph to:

```md
This repository is in early capture-runtime setup. The package structure exists, and `autodemo capture` now launches a Playwright-controlled Chromium browser for viewport media recording, writes browser interaction metadata to JSONL, and emits a temporary capture bundle manifest. Polish, render, and editor behavior are still planned work.
```

Update the capture package bullet to:

```md
- `@auto-demo/capture`: browser-first capture adapter contract, default Playwright viewport recorder, interaction metadata JSONL capture, capture output paths, and unsupported-backend fallback.
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/index.test.ts packages/capture/src/playwrightAdapter.smoke.test.ts README.md
git commit -m "test: verify capture metadata artifacts"
```

## Task 6: Full Verification And Project Map Update

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Run focused package tests**

Run:

```bash
npm --workspace @auto-demo/capture test
npm --workspace @auto-demo/cli test
```

Expected: both commands PASS.

- [ ] **Step 2: Run typecheck/build validation**

Run:

```bash
npm run validate
```

Expected: PASS.

- [ ] **Step 3: Run smoke verification**

Run:

```bash
npm --workspace @auto-demo/capture run test:smoke
```

Expected: PASS, with a non-empty viewport video and parseable `metadata/events.jsonl`.

- [ ] **Step 4: Update project map investigation and completion evidence**

Append concise WES-145 evidence to `docs/linear/auto-demo-project-structure.md`:

```md
- WES-145 implementation: browser interaction metadata capture writes `metadata/events.jsonl` alongside Playwright viewport media, returns a metadata artifact path in `CaptureOutput`, redacts typed values by default with coarse classification, and preserves CLI lifecycle behavior.
```

Append verification evidence:

```md
- WES-145 verification: `npm --workspace @auto-demo/capture test`, `npm --workspace @auto-demo/cli test`, `npm run validate`, and `npm --workspace @auto-demo/capture run test:smoke` passed locally.
```

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat
git diff -- packages/capture/src/index.ts packages/capture/src/playwrightAdapter.ts packages/capture/src/playwrightMetadataRecorder.ts
```

Expected: diff shows metadata contract, event writer/recorder integration, and no durable manifest writer.

- [ ] **Step 6: Commit**

```bash
git add docs/linear/auto-demo-project-structure.md
git commit -m "docs: record WES-145 metadata capture evidence"
```

## Self-Review

- Spec coverage: Tasks cover metadata file creation, ordered JSONL events, navigation/click/fill/press/viewport/console/page-error event paths, redaction/classification, metadata in `CaptureOutput`, CLI lifecycle preservation, smoke artifact verification, and project map evidence. WES-147 manifest writing and public agent APIs remain out of scope.
- Red-flag scan: The plan contains no unresolved sections. The only conditional branch is the adapter stop-failure test fallback, and it preserves the exact observable behavior when platform file semantics make the first test shape unreliable.
- Type consistency: `CaptureMetadataArtifact`, `CaptureOutput.metadata`, `CaptureEvent`, `CaptureEventFactory`, `JsonlEventWriter`, `PlaywrightMetadataRecorder`, and extended `PlaywrightPage` names are consistent across tasks.
