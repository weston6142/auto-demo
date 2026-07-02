import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoadedProject, ProjectVariant } from "@auto-demo/project";

export type PolishPackageRole = "edit-decision-generation";

export const polishPackageRole: PolishPackageRole = "edit-decision-generation";

export type GenerateBaselinePolishOptions = {
  id?: string;
  displayName?: string;
};

export type PolishWarningCode =
  | "events_file_unreadable"
  | "events_file_empty"
  | "malformed_event_line"
  | "missing_action_events"
  | "missing_click_coordinates"
  | "incomplete_capture_status";

export type PolishWarning = {
  code: PolishWarningCode;
  message: string;
};

export type BaselinePolishResult = {
  variant: ProjectVariant;
  warnings: PolishWarning[];
};

type CaptureEventRecord = {
  type: string;
  timestampMs: number;
  viewport?: {
    width?: number;
    height?: number;
  };
  data?: Record<string, unknown>;
};

const ACTION_EVENT_TYPES = new Set(["click", "fill", "press", "navigation", "agent_step"]);

export async function generateBaselinePolishVariant(
  project: LoadedProject,
  options: GenerateBaselinePolishOptions = {},
): Promise<BaselinePolishResult> {
  const warnings: PolishWarning[] = [];
  const events = await readProjectEvents(project, warnings);
  const durationMs = project.manifest.sourceCapture.timing.durationMs;
  const actionEvents = events
    .filter((event) => ACTION_EVENT_TYPES.has(event.type))
    .filter((event) => event.timestampMs >= 0 && event.timestampMs <= durationMs)
    .sort((a, b) => a.timestampMs - b.timestampMs);
  const clickEvents = events.filter((event) => event.type === "click");
  const clickFocus = findClickFocus(clickEvents, project.manifest.sourceCapture.viewport);

  if (actionEvents.length === 0) {
    warnings.push({
      code: "missing_action_events",
      message: "No interaction events were available for baseline polish decisions.",
    });
  }

  if (clickEvents.length > 0 && clickFocus === null) {
    warnings.push({
      code: "missing_click_coordinates",
      message: "Click events did not include usable viewport coordinates.",
    });
  }

  if (project.manifest.sourceCapture.status !== "completed") {
    warnings.push({
      code: "incomplete_capture_status",
      message: "Source capture did not complete; baseline polish used available metadata.",
    });
  }

  const hasActions = actionEvents.length > 0;
  const variant: ProjectVariant = {
    id: options.id ?? "baseline-polish",
    displayName: options.displayName ?? "Baseline Polish",
    source: {
      mediaPath: project.manifest.media.primary.path,
      eventsPath: project.manifest.metadata.events.path,
    },
    timeline: buildTimeline(actionEvents, durationMs),
    viewport: {
      mode: "contain",
      focus: clickFocus ?? { x: 0.5, y: 0.5 },
      zoom: clickFocus !== null ? 1.35 : hasActions ? 1.15 : 1,
    },
    cursor: {
      visible: true,
      emphasis: hasActions ? "spotlight" : "none",
    },
    clicks: {
      emphasis: clickEvents.length > 0 ? "ring" : "none",
    },
    captions: [],
    callouts: [],
    style: {
      background: "solid",
      backgroundColor: "#0f172a",
      frame: "browser",
      padding: 48,
      cornerRadius: 16,
    },
    exportIntent: {
      format: "mp4",
      quality: "demo",
      aspectRatio: "16:9",
    },
  };

  return { variant, warnings: uniqueWarnings(warnings) };
}

async function readProjectEvents(
  project: LoadedProject,
  warnings: PolishWarning[],
): Promise<CaptureEventRecord[]> {
  const eventsPath = join(project.projectDir, project.manifest.metadata.events.path);
  let content: string;

  try {
    content = await readFile(eventsPath, "utf8");
  } catch {
    warnings.push({
      code: "events_file_unreadable",
      message: "Capture events file could not be read; baseline polish used safe defaults.",
    });
    return [];
  }

  if (content.trim().length === 0) {
    warnings.push({
      code: "events_file_empty",
      message: "Capture events file contained no events; baseline polish used safe defaults.",
    });
    return [];
  }

  const events: CaptureEventRecord[] = [];
  let malformed = false;

  for (const line of content.split(/\r?\n/)) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as unknown;
      const event = parseEventRecord(parsed);
      if (event === null) {
        malformed = true;
      } else {
        events.push(event);
      }
    } catch {
      malformed = true;
    }
  }

  if (malformed) {
    warnings.push({
      code: "malformed_event_line",
      message: "One or more capture event lines could not be parsed.",
    });
  }

  if (events.length === 0) {
    warnings.push({
      code: "events_file_empty",
      message: "Capture events file contained no events; baseline polish used safe defaults.",
    });
  }

  return events;
}

function parseEventRecord(value: unknown): CaptureEventRecord | null {
  if (!isRecord(value) || typeof value.type !== "string" || !isInteger(value.timestampMs)) {
    return null;
  }

  const viewport = isRecord(value.viewport)
    ? {
        width: numberOrUndefined(value.viewport.width),
        height: numberOrUndefined(value.viewport.height),
      }
    : undefined;

  return {
    type: value.type,
    timestampMs: value.timestampMs,
    viewport,
    data: isRecord(value.data) ? value.data : undefined,
  };
}

function buildTimeline(
  actionEvents: CaptureEventRecord[],
  durationMs: number,
): ProjectVariant["timeline"] {
  if (actionEvents.length === 0) {
    return { startMs: 0, endMs: durationMs };
  }

  const firstActionMs = actionEvents[0]?.timestampMs ?? 0;
  const lastActionMs = actionEvents[actionEvents.length - 1]?.timestampMs ?? durationMs;
  const startMs = firstActionMs > 1000 ? Math.max(0, firstActionMs - 500) : 0;
  const endMs =
    durationMs - lastActionMs > 1000 ? Math.min(durationMs, lastActionMs + 750) : durationMs;

  return { startMs, endMs: Math.max(startMs + 1, endMs) };
}

function findClickFocus(
  clickEvents: CaptureEventRecord[],
  fallbackViewport: { width: number; height: number },
): { x: number; y: number } | null {
  for (const event of clickEvents) {
    const x = numberOrUndefined(event.data?.x);
    const y = numberOrUndefined(event.data?.y);
    const width = event.viewport?.width ?? fallbackViewport.width;
    const height = event.viewport?.height ?? fallbackViewport.height;

    if (
      x !== undefined &&
      y !== undefined &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0
    ) {
      return {
        x: roundNormalized(clamp(x / width, 0, 1)),
        y: roundNormalized(clamp(y / height, 0, 1)),
      };
    }
  }

  return null;
}

function uniqueWarnings(warnings: PolishWarning[]): PolishWarning[] {
  const seen = new Set<PolishWarningCode>();
  return warnings.filter((warning) => {
    if (seen.has(warning.code)) {
      return false;
    }
    seen.add(warning.code);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundNormalized(value: number): number {
  return Math.round(value * 1000) / 1000;
}
