export type CaptureSource =
  | {
      kind: "browser";
      url: string;
    }
  | {
      kind: "mac-native";
      displayId?: string;
      windowId?: string;
    };

export type CaptureOptions = {
  projectName: string;
  source: CaptureSource;
};

export type CaptureOutput = {
  projectRoot: string;
  manifestPath: string;
};

export type CaptureErrorCode = "capture_not_implemented";

export type CaptureResult =
  { ok: true; output: CaptureOutput } | { ok: false; code: CaptureErrorCode; message: string };

export type CaptureSession = {
  stop(): Promise<CaptureResult>;
};

export type CaptureAdapter = {
  readonly kind: CaptureSource["kind"];
  start(options: CaptureOptions): Promise<CaptureResult>;
};

export function createUnsupportedCaptureAdapter(kind: CaptureSource["kind"]): CaptureAdapter {
  return {
    kind,
    async start() {
      const label = kind === "browser" ? "Browser" : "Mac-native";
      return {
        ok: false,
        code: "capture_not_implemented",
        message: `${label} capture is not implemented yet.`,
      };
    },
  };
}
