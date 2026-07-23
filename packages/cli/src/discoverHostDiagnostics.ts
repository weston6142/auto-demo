import { open } from "node:fs/promises";
import { join } from "node:path";
import type {
  CoordinateDiscoveryActResult,
  CoordinateDiscoveryBoundary,
  CoordinateDiscoveryDiagnosticEvent,
  DiscoveryBrowserLaunchAttempt,
} from "@auto-demo/agent";

const DIAGNOSTIC_FILENAME = "discover-host-diagnostics.jsonl";
const MAX_SESSION_ELAPSED_MS = 86_400_000;

export type DiscoverRuntimeOperationStage =
  | "browser_launch"
  | "capture_setup"
  | "host_socket_bind"
  | "coordinate_session_start"
  | "initial_frame_persistence"
  | "coordinate_session"
  | "frame_persistence"
  | "checkpoint_persistence"
  | "checkpoint_or_close"
  | "finalization"
  | "review_plan_persistence"
  | "review_artifact_persistence";

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
      ordinal: 1 | 2 | 3;
      profileId: string;
      status: number;
      originRelation: "same-origin" | "other-origin";
    }
  | {
      event: "browser_launch_attempt";
      ordinal: 1 | 2 | 3;
      profileId: string;
      outcome: "browser_launch_failed" | "browser_navigation_failed" | "anti_bot_challenge";
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

export function createDiscoverPageDiagnostics(input: {
  startUrl: string;
  recorder: DiscoverHostDiagnosticRecorder;
}): {
  onMainDocumentResponse(response: {
    ordinal: 1 | 2 | 3;
    profileId: string;
    status: number;
    url: string;
  }): void;
  onLaunchAttempt(attempt: DiscoveryBrowserLaunchAttempt): void;
  close(): Promise<void>;
} {
  const startOrigin = new URL(input.startUrl).origin;
  let pending = Promise.resolve();
  const queueEvent = (event: DiscoverHostDiagnosticEvent) => {
    const recorded = input.recorder.record(event).catch(() => undefined);
    pending = pending.then(async () => await recorded);
  };
  return {
    onMainDocumentResponse(response) {
      const status = response.status;
      if (!Number.isInteger(status) || status < 100 || status > 599) return;
      try {
        const originRelation =
          new URL(response.url).origin === startOrigin ? "same-origin" : "other-origin";
        queueEvent({
          event: "main_document_response",
          ordinal: response.ordinal,
          profileId: response.profileId,
          status,
          originRelation,
        });
      } catch {
        // Diagnostics cannot alter browser behavior.
      }
    },
    onLaunchAttempt(attempt) {
      queueEvent({
        event: "browser_launch_attempt",
        ordinal: attempt.ordinal,
        profileId: attempt.profileId,
        outcome: attempt.outcome,
      });
    },
    async close() {
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
        ordinal: boundedInteger(event.ordinal, 1, 3) as 1 | 2 | 3,
        profileId: boundedProfileId(event.profileId),
        status: boundedInteger(event.status, 100, 599),
        originRelation: event.originRelation,
      };
    case "browser_launch_attempt":
      return {
        event: event.event,
        ordinal: boundedInteger(event.ordinal, 1, 3) as 1 | 2 | 3,
        profileId: boundedProfileId(event.profileId),
        outcome: event.outcome,
      };
    case "coordinate_action_stage_failed":
      return {
        event: event.event,
        stage: event.stage,
        actionIndex: boundedInteger(event.actionIndex, 0, 10_000),
        actionType: event.actionType,
      };
    case "coordinate_session_stage_failed":
      return { event: event.event, stage: event.stage };
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
