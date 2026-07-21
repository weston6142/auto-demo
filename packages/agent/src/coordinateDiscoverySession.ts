import type { ScreenPoint } from "@auto-demo/browser-input";
import type {
  CapturedCoordinateFrame,
  CoordinateTargetEvidence,
} from "./playwrightCoordinateDiscoveryPage.js";
import {
  parseCoordinateActionBatch,
  type CoordinateDiscoveryAction,
} from "./coordinateDiscoveryContract.js";
import type { DiscoveryAction, DiscoveryInteractiveTarget } from "./discoveryContract.js";

export type CoordinatePageState = {
  documentToken: string;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  scroll: { x: number; y: number };
  popup: "closed" | "open";
  layoutIdentity: string;
};

export interface CoordinateDiscoveryPage {
  pointer(): ScreenPoint;
  captureFrame(input: {
    id: string;
    pointer: ScreenPoint;
    grid: boolean;
  }): Promise<CapturedCoordinateFrame>;
  state(): Promise<CoordinatePageState>;
  challenge(): Promise<boolean>;
  inspectPoint(point: ScreenPoint): Promise<CoordinateTargetEvidence | undefined>;
  execute(action: CoordinateDiscoveryAction): Promise<void>;
}

export type CoordinateTraceRecord = {
  actionIndex: number;
  actionType: CoordinateDiscoveryAction["type"];
  semanticAction?: DiscoveryAction;
  target?: DiscoveryInteractiveTarget;
  publicEffect?: "none" | "navigation" | "scroll" | "popup" | "layout" | "form-change";
  pageBefore?: { url: string; title: string };
  pageAfter?: { url: string; title: string };
};

export type CoordinateDiscoveryBoundary =
  | "unchanged"
  | "navigation"
  | "page_scrolled"
  | "popup_opened"
  | "viewport_changed"
  | "layout_changed";

export type CoordinateDiscoveryActResult =
  | {
      ok: true;
      executedActions: number;
      boundary: CoordinateDiscoveryBoundary;
      frame?: CapturedCoordinateFrame;
    }
  | {
      ok: false;
      executedActions: number;
      code:
        | "invalid_action_batch"
        | "stale_frame"
        | "action_failed"
        | "frame_unavailable"
        | "anti_bot_challenge";
      message: string;
      failedActionIndex?: number;
      frame?: CapturedCoordinateFrame;
    };

export type CoordinateDiscoverySession = {
  start(): Promise<
    | { ok: true; frame: CapturedCoordinateFrame }
    | { ok: false; code: "frame_unavailable"; message: string }
  >;
  observe(): Promise<
    | { ok: true; frame: CapturedCoordinateFrame }
    | { ok: false; code: "frame_unavailable"; message: string }
  >;
  act(value: unknown): Promise<CoordinateDiscoveryActResult>;
  durableTrace(): CoordinateTraceRecord[];
  runtimeBindings(): Record<string, string>;
};

export function createCoordinateDiscoverySession(input: {
  page: CoordinateDiscoveryPage;
  grid: boolean;
}): CoordinateDiscoverySession {
  let frameNumber = 0;
  let activeFrame: CapturedCoordinateFrame | undefined;
  let activeState: CoordinatePageState | undefined;
  let lastTarget: CoordinateTargetEvidence | undefined;
  let lastTargetPoint: ScreenPoint | undefined;
  let challengeDetected = false;
  const trace: CoordinateTraceRecord[] = [];
  const bindings = new Map<string, string>();

  const capture = async (): Promise<CapturedCoordinateFrame> => {
    const frame = await input.page.captureFrame({
      id: `frame-${++frameNumber}`,
      pointer: input.page.pointer(),
      grid: input.grid,
    });
    activeFrame = frame;
    activeState = await input.page.state();
    return frame;
  };

  return {
    async start() {
      if (activeFrame !== undefined) return { ok: true, frame: activeFrame };
      try {
        return { ok: true, frame: await capture() };
      } catch {
        return {
          ok: false,
          code: "frame_unavailable",
          message: "Coordinate discovery frame is unavailable.",
        };
      }
    },

    async observe() {
      try {
        return { ok: true, frame: await capture() };
      } catch {
        return {
          ok: false,
          code: "frame_unavailable",
          message: "Coordinate discovery frame is unavailable.",
        };
      }
    },

    async act(value): Promise<CoordinateDiscoveryActResult> {
      if (challengeDetected || (await input.page.challenge())) {
        challengeDetected = true;
        return failure(
          "anti_bot_challenge",
          0,
          "Coordinate discovery stopped at an anti-bot challenge.",
          undefined,
          activeFrame,
        );
      }
      if (activeFrame === undefined || activeState === undefined) {
        return failure("stale_frame", 0, "Coordinate discovery frame is stale.");
      }
      const parsed = parseCoordinateActionBatch(value, {
        width: activeFrame.width,
        height: activeFrame.height,
      });
      if (!parsed.ok) {
        return failure("invalid_action_batch", 0, "Coordinate discovery action batch is invalid.");
      }
      if (parsed.batch.frameId !== activeFrame.id) {
        return failure("stale_frame", 0, "Coordinate discovery frame is stale.");
      }
      const currentState = await input.page.state();
      if (classifyBoundary(activeState, currentState) !== "unchanged") {
        try {
          return failure(
            "stale_frame",
            0,
            "Coordinate discovery frame is stale.",
            undefined,
            await capture(),
          );
        } catch {
          return failure("stale_frame", 0, "Coordinate discovery frame is stale.");
        }
      }

      let executedActions = 0;
      for (let index = 0; index < parsed.batch.actions.length; index += 1) {
        const action = parsed.batch.actions[index]!;
        const before = await input.page.state();
        const point = actionPoint(action);
        const target = point === undefined ? lastTarget : await input.page.inspectPoint(point);
        if (point !== undefined) {
          lastTarget = target;
          lastTargetPoint = point;
        }
        try {
          await input.page.execute(action);
        } catch {
          return await failedAction(index, executedActions);
        }
        executedActions += 1;
        const after = await input.page.state();
        if (await input.page.challenge()) {
          challengeDetected = true;
          try {
            return failure(
              "anti_bot_challenge",
              executedActions,
              "Coordinate discovery stopped at an anti-bot challenge.",
              index,
              await capture(),
            );
          } catch {
            return failure(
              "anti_bot_challenge",
              executedActions,
              "Coordinate discovery stopped at an anti-bot challenge.",
              index,
            );
          }
        }
        const afterTarget =
          lastTargetPoint === undefined
            ? undefined
            : await input.page.inspectPoint(lastTargetPoint).catch(() => undefined);
        const semanticAction = semanticIntent(action, target, afterTarget, bindings, index);
        trace.push({
          actionIndex: trace.length,
          actionType: action.type,
          ...(semanticAction === undefined ? {} : { semanticAction }),
          ...(target === undefined ? {} : { target: structuredClone(target.target) }),
          publicEffect: publicEffect(before, after, target, afterTarget),
          pageBefore: { url: before.url, title: before.title || "Untitled page" },
          pageAfter: { url: after.url, title: after.title || "Untitled page" },
        });
        if (afterTarget !== undefined) lastTarget = afterTarget;

        const boundary = classifyBoundary(before, after);
        if (boundary !== "unchanged") {
          try {
            const boundaryFrame = await capture();
            return {
              ok: true,
              executedActions,
              boundary,
              frame: boundaryFrame,
            };
          } catch {
            return failure(
              "frame_unavailable",
              executedActions,
              "Coordinate discovery frame is unavailable.",
              index,
            );
          }
        }
        activeState = after;
      }
      return { ok: true, executedActions, boundary: "unchanged" };
    },

    durableTrace() {
      return structuredClone(trace);
    },

    runtimeBindings() {
      return Object.fromEntries(bindings);
    },
  };

  async function failedAction(
    failedActionIndex: number,
    executedActions: number,
  ): Promise<CoordinateDiscoveryActResult> {
    try {
      return failure(
        "action_failed",
        executedActions,
        "Coordinate discovery action failed.",
        failedActionIndex,
        await capture(),
      );
    } catch {
      return failure(
        "action_failed",
        executedActions,
        "Coordinate discovery action failed.",
        failedActionIndex,
      );
    }
  }
}

function semanticIntent(
  action: CoordinateDiscoveryAction,
  beforeTarget: CoordinateTargetEvidence | undefined,
  afterTarget: CoordinateTargetEvidence | undefined,
  bindings: Map<string, string>,
  actionIndex: number,
): DiscoveryAction | undefined {
  if (action.type === "click" && beforeTarget !== undefined) {
    return { kind: "click", targetId: beforeTarget.target.id };
  }
  if (action.type === "double-click" && beforeTarget !== undefined) {
    return { kind: "click", targetId: beforeTarget.target.id };
  }
  if (action.type === "type" && beforeTarget !== undefined) {
    const inputBinding = action.binding ?? `coordinate-input-${actionIndex + 1}`;
    bindings.set(inputBinding, action.text);
    return {
      kind: "type",
      targetId: beforeTarget.target.id,
      inputBinding,
      valueClass: "demo-data",
    };
  }
  if (
    action.type === "keypress" &&
    beforeTarget?.target.form?.selectedOption !== undefined &&
    afterTarget?.target.form?.selectedOption !== undefined &&
    beforeTarget.target.form.selectedOption !== afterTarget.target.form.selectedOption
  ) {
    return {
      kind: "select",
      targetId: beforeTarget.target.id,
      optionLabel: afterTarget.target.form.selectedOption,
    };
  }
  if (action.type === "wait") return { kind: "wait", durationMs: action.durationMs };
  return undefined;
}

function actionPoint(action: CoordinateDiscoveryAction): ScreenPoint | undefined {
  return "x" in action && "y" in action ? { x: action.x, y: action.y } : undefined;
}

function classifyBoundary(
  before: CoordinatePageState,
  after: CoordinatePageState,
): CoordinateDiscoveryBoundary {
  if (before.documentToken !== after.documentToken || before.url !== after.url) return "navigation";
  if (
    before.viewport.width !== after.viewport.width ||
    before.viewport.height !== after.viewport.height
  ) {
    return "viewport_changed";
  }
  if (before.popup === "closed" && after.popup === "open") return "popup_opened";
  if (before.scroll.x !== after.scroll.x || before.scroll.y !== after.scroll.y)
    return "page_scrolled";
  if (before.layoutIdentity !== after.layoutIdentity || before.popup !== after.popup) {
    return "layout_changed";
  }
  return "unchanged";
}

function publicEffect(
  before: CoordinatePageState,
  after: CoordinatePageState,
  beforeTarget: CoordinateTargetEvidence | undefined,
  afterTarget: CoordinateTargetEvidence | undefined,
): CoordinateTraceRecord["publicEffect"] {
  if (before.documentToken !== after.documentToken || before.url !== after.url) return "navigation";
  if (before.scroll.x !== after.scroll.x || before.scroll.y !== after.scroll.y) return "scroll";
  if (before.popup !== after.popup) return "popup";
  if (beforeTarget?.target.form?.selectedOption !== afterTarget?.target.form?.selectedOption) {
    return "form-change";
  }
  if (before.layoutIdentity !== after.layoutIdentity) return "layout";
  return "none";
}

function failure(
  code: Extract<CoordinateDiscoveryActResult, { ok: false }>["code"],
  executedActions: number,
  message: string,
  failedActionIndex?: number,
  frame?: CapturedCoordinateFrame,
): CoordinateDiscoveryActResult {
  return {
    ok: false,
    executedActions,
    code,
    message,
    ...(failedActionIndex === undefined ? {} : { failedActionIndex }),
    ...(frame === undefined ? {} : { frame }),
  };
}
