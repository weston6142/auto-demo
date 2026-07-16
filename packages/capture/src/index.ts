import { createPlaywrightBrowserCaptureAdapter } from "./playwrightAdapter.js";
export {
  CAPTURE_MANIFEST_SCHEMA_VERSION,
  CAPTURE_PACKAGE_VERSION,
  PLAYWRIGHT_TOOL_VERSION,
  readCaptureManifest,
  validateCaptureBundle,
  writeCaptureManifest,
  type CaptureBundleValidationResult,
  type CaptureManifest,
  type CaptureManifestAdapter,
  type CaptureManifestArtifacts,
  type CaptureManifestChildCommand,
  type CaptureManifestError,
  type CaptureManifestStatus,
  type CaptureManifestTools,
  type WriteCaptureManifestInput,
} from "./captureManifest.js";

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

/** Interaction metadata artifact written as newline-delimited JSON events. */
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
  /** Browser interaction metadata captured alongside viewport media. */
  metadata: CaptureMetadataArtifact;
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
  /** Stop failures keep outputDir/manifestPath so callers can report preserved diagnostic bundles. */
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

export type BrowserExecutionTarget = {
  label: string;
  role?: string;
  occurrence?: number;
};

export type BrowserNavigationExpectation = {
  url: string;
  match: "exact-url" | "same-origin-path";
};

export type BrowserCaptureController = {
  navigate(url: string): Promise<void>;
  click(target: BrowserExecutionTarget): Promise<void>;
  type(target: BrowserExecutionTarget, value: string, options: { delayMs: number }): Promise<void>;
  assertVisible(target: BrowserExecutionTarget): Promise<void>;
  assertNavigation(expectation: BrowserNavigationExpectation): Promise<void>;
  waitForSettled(): Promise<void>;
};

export type ControllableCaptureSession = CaptureSession & {
  readonly browser: BrowserCaptureController;
};

export type ControllableCaptureStartResult =
  | {
      ok: true;
      session: ControllableCaptureSession;
      outputDir: string;
      manifestPath: string;
    }
  | Extract<CaptureStartResult, { ok: false }>;

export type ControllableBrowserCaptureAdapter = {
  readonly kind: "browser";
  start(options: BrowserCaptureOptions): Promise<ControllableCaptureStartResult>;
};

/** Creates the default browser capture backend for real viewport media and interaction metadata recording. */
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
