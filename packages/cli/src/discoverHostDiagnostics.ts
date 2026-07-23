import { open } from "node:fs/promises";
import { join } from "node:path";
import type {
  CoordinateDiscoveryActResult,
  CoordinateDiscoveryBoundary,
  CoordinateDiscoveryDiagnosticEvent,
} from "@auto-demo/agent";

const DIAGNOSTIC_FILENAME = "discover-host-diagnostics.jsonl";
const MAX_SESSION_ELAPSED_MS = 86_400_000;

export type DiscoverRuntimeOperationStage =
  | "capture_setup"
  | "coordinate_session_start"
  | "initial_frame_persistence"
  | "coordinate_session"
  | "frame_persistence"
  | "checkpoint_persistence"
  | "checkpoint_or_close";

export type DiscoverHostDiagnosticEvent =
  | CoordinateDiscoveryDiagnosticEvent
  | {
      event: "runtime_started";
      profileId: string;
      channel: "bundled" | "chrome" | "msedge";
      headless: boolean;
      viewport: { width: number; height: number };
    }
  | {
      event: "main_document_response";
      status: number;
      originRelation: "same-origin" | "other-origin";
    }
  | {
      event: "coordinate_act_result";
      ok: boolean;
      executedActions: number;
      boundary?: CoordinateDiscoveryBoundary;
      code?: Extract<CoordinateDiscoveryActResult, { ok: false }>["code"];
    }
  | {
      event: "runtime_operation_failed";
      operation: "act" | "observe" | "finish" | "abandon" | "startup";
      stage: DiscoverRuntimeOperationStage;
    }
  | { event: "runtime_stopped" };

export type DiscoverHostDiagnosticRecorder = {
  record(event: DiscoverHostDiagnosticEvent): Promise<void>;
  close(): Promise<void>;
};

export type DiscoverDiagnosticResponse = {
  request(): { resourceType(): string };
  frame(): object;
  status(): number;
  url(): string;
};

export type DiscoverDiagnosticPage = {
  mainFrame(): object;
  onResponse(listener: (response: DiscoverDiagnosticResponse) => void): void;
  offResponse(listener: (response: DiscoverDiagnosticResponse) => void): void;
};

export async function createDiscoverHostDiagnosticRecorder(
  sessionDirectory: string,
): Promise<DiscoverHostDiagnosticRecorder> {
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
        sessionElapsedMs: Math.min(MAX_SESSION_ELAPSED_MS, elapsedMilliseconds(started)),
        ...boundedEvent(event),
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

export function attachDiscoverPageDiagnostics(input: {
  page: DiscoverDiagnosticPage;
  startUrl: string;
  recorder: DiscoverHostDiagnosticRecorder;
}): { close(): Promise<void> } {
  const startOrigin = new URL(input.startUrl).origin;
  let pending = Promise.resolve();
  const listener = (response: DiscoverDiagnosticResponse) => {
    try {
      if (
        response.request().resourceType() !== "document" ||
        response.frame() !== input.page.mainFrame()
      ) {
        return;
      }
      const status = response.status();
      if (!Number.isInteger(status) || status < 100 || status > 599) return;
      const originRelation =
        new URL(response.url()).origin === startOrigin ? "same-origin" : "other-origin";
      pending = pending
        .then(async () =>
          input.recorder.record({ event: "main_document_response", status, originRelation }),
        )
        .catch(() => undefined);
    } catch {
      return;
    }
  };
  let attached = false;
  try {
    input.page.onResponse(listener);
    attached = true;
  } catch {
    attached = false;
  }
  return {
    async close() {
      if (attached) {
        try {
          input.page.offResponse(listener);
        } catch {
          // Diagnostics are best-effort and cannot alter browser cleanup.
        }
      }
      await pending;
    },
  };
}

function boundedEvent(event: DiscoverHostDiagnosticEvent): DiscoverHostDiagnosticEvent {
  switch (event.event) {
    case "runtime_started":
      return {
        event: event.event,
        profileId: boundedProfileId(event.profileId),
        channel: event.channel,
        headless: event.headless,
        viewport: {
          width: boundedInteger(event.viewport.width, 1, 4096),
          height: boundedInteger(event.viewport.height, 1, 4096),
        },
      };
    case "main_document_response":
      return {
        event: event.event,
        status: boundedInteger(event.status, 100, 599),
        originRelation: event.originRelation,
      };
    case "coordinate_action_stage_failed":
      return {
        event: event.event,
        stage: event.stage,
        actionIndex: boundedInteger(event.actionIndex, 0, 10_000),
        actionType: event.actionType,
      };
    case "coordinate_act_result":
      return {
        event: event.event,
        ok: event.ok,
        executedActions: boundedInteger(event.executedActions, 0, 10_000),
        ...(event.boundary === undefined ? {} : { boundary: event.boundary }),
        ...(event.code === undefined ? {} : { code: event.code }),
      };
    case "runtime_operation_failed":
      return {
        event: event.event,
        operation: event.operation,
        stage: event.stage,
      };
    case "runtime_stopped":
      return { event: event.event };
  }
}

function boundedProfileId(value: string): string {
  return /^sha256:[a-f0-9]{64}$/u.test(value) ? value : "invalid-profile-id";
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  return Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum;
}

function elapsedMilliseconds(started: number): number {
  return Math.max(0, Math.round(performance.now() - started));
}
