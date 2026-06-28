export const CAPTURE_MANIFEST_FILENAME = "capture.manifest.json";
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

export type CaptureOutput = {
  outputDir: string;
  manifestPath: string;
};

export type CaptureErrorCode = "capture_not_implemented";

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

export function manifestPathForOutputDir(outputDir: string): string {
  return `${trimTrailingSlashes(outputDir)}/${CAPTURE_MANIFEST_FILENAME}`;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
