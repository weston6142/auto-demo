import { open } from "node:fs/promises";
import { join } from "node:path";

const DIAGNOSTIC_FILENAME = "native-capture-diagnostics.jsonl";

export type NativeCaptureRegion = { x: number; y: number; width: number; height: number };

export type MacOsCaptureDiagnosticEvent = {
  event: "browser_capture_failed";
  stage: "png_normalization";
  region: NativeCaptureRegion;
  viewport: { width: number; height: number };
};

export type NativeCaptureDiagnosticRecord =
  | MacOsCaptureDiagnosticEvent
  | { event: "helper_started" | "helper_stopped" }
  | {
      event: "helper_start_failed" | "helper_stop_failed";
      stage: "helper_lifecycle";
    }
  | {
      event: "capture_succeeded";
      attempt: number;
      elapsedMs: number;
      region: NativeCaptureRegion;
      byteLength: number;
    }
  | {
      event: "capture_failed";
      attempt: number;
      elapsedMs: number;
      region: NativeCaptureRegion;
      code: string;
      stage: string;
      systemErrorDomain?: string;
      systemErrorCode?: number;
    };

export type NativeCaptureDiagnosticRecorder = {
  record(event: NativeCaptureDiagnosticRecord): Promise<void>;
  close(): Promise<void>;
};

export async function createNativeCaptureDiagnosticRecorder(
  sessionDirectory: string,
): Promise<NativeCaptureDiagnosticRecorder> {
  const started = performance.now();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(join(sessionDirectory, DIAGNOSTIC_FILENAME), "wx", 0o600);
  } catch {
    return { async record() {}, async close() {} };
  }
  let sequence = 0;
  let writes = Promise.resolve();
  return {
    async record(event) {
      sequence += 1;
      const line = `${JSON.stringify({
        schemaVersion: 1,
        sequence,
        sessionElapsedMs: Math.min(86_400_000, elapsedMilliseconds(started)),
        ...event,
      })}\n`;
      writes = writes.then(async () => await handle!.appendFile(line)).catch(() => undefined);
      await writes;
    },
    async close() {
      await writes;
      await handle?.close().catch(() => undefined);
      handle = undefined;
    },
  };
}

export function elapsedMilliseconds(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
