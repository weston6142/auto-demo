import { describe, expect, it } from "vitest";
import type { CoordinateDiscoveryAction } from "./coordinateDiscoveryContract.js";
import {
  createCoordinateDiscoverySession,
  type CoordinateDiscoveryPage,
  type CoordinatePageState,
} from "./coordinateDiscoverySession.js";
import type { CoordinateTargetEvidence } from "./playwrightCoordinateDiscoveryPage.js";

class FakeCoordinatePage implements CoordinateDiscoveryPage {
  readonly executed: CoordinateDiscoveryAction[] = [];
  readonly frameIds: string[] = [];
  private point = { x: 0, y: 0 };
  private pageState: CoordinatePageState = {
    documentToken: "document-1",
    url: "https://example.test/search",
    title: "Vehicle search",
    viewport: { width: 800, height: 600 },
    scroll: { x: 0, y: 0 },
    popup: "closed",
    layoutIdentity: "layout-1",
  };
  private selectedOption = "Any make";
  private blocked = false;

  shiftLayout() {
    this.pageState.layoutIdentity = "layout-external";
  }

  pointer() {
    return { ...this.point };
  }

  async captureFrame(input: { id: string; pointer: { x: number; y: number }; grid: boolean }) {
    this.frameIds.push(input.id);
    return {
      id: input.id,
      png: Buffer.from("png"),
      width: 800,
      height: 600,
      deviceScaleFactor: 1 as const,
      pointer: { ...input.pointer },
    };
  }

  async state() {
    return structuredClone(this.pageState);
  }

  async challenge() {
    return this.blocked;
  }

  async inspectPoint(point: {
    x: number;
    y: number;
  }): Promise<CoordinateTargetEvidence | undefined> {
    if (point.x < 200) {
      return {
        identityKey: "make-control",
        target: {
          id: "target-make",
          label: "Make",
          role: "combobox",
          occurrence: 1,
          disabled: false,
          form: {
            required: false,
            hasValue: true,
            validity: "valid",
            selectedOption: this.selectedOption,
            options: [
              { label: "Any make", disabled: false, selected: this.selectedOption === "Any make" },
              { label: "Kia", disabled: false, selected: this.selectedOption === "Kia" },
            ],
          },
        },
        risk: { credential: false, sensitivePayment: false, upload: false },
      };
    }
    if (point.x < 400) {
      return {
        identityKey: "model-control",
        target: {
          id: "target-model",
          label: "Model",
          role: "textbox",
          occurrence: 1,
          disabled: false,
          form: { required: false, hasValue: false, validity: "valid" },
        },
        risk: { credential: false, sensitivePayment: false, upload: false },
      };
    }
    return undefined;
  }

  async execute(action: CoordinateDiscoveryAction) {
    this.executed.push(structuredClone(action));
    if ("x" in action && "y" in action) this.point = { x: action.x, y: action.y };
    if (action.type === "click" && action.x < 200) this.pageState.popup = "open";
    if (action.type === "keypress" && action.keys.includes("ENTER")) {
      this.selectedOption = "Kia";
      this.pageState.popup = "closed";
      this.pageState.layoutIdentity = "layout-2";
    }
    if (action.type === "scroll") this.pageState.scroll.y += action.deltaY;
    if (action.type === "click" && action.x > 600) {
      this.pageState.documentToken = "document-blocked";
      this.pageState.url = "https://example.test/blocked";
      this.pageState.title = "Verify you are human";
      this.blocked = true;
    }
  }
}

async function started(page = new FakeCoordinatePage()) {
  const session = createCoordinateDiscoverySession({ page, grid: false });
  const result = await session.start();
  if (!result.ok) throw new Error("fixture session failed to start");
  return { page, session, frame: result.frame };
}

describe("coordinate discovery session", () => {
  it("observes a fresh frame and invalidates the prior frame", async () => {
    const { page, session, frame } = await started();
    const observed = await session.observe();
    if (!observed.ok) throw new Error("fresh observation missing");

    expect(observed.frame.id).toBe("frame-2");
    expect(
      await session.act({
        frameId: frame.id,
        actions: [{ type: "move", x: 10, y: 10 }],
      }),
    ).toMatchObject({ ok: false, code: "stale_frame", executedActions: 0 });
    expect(page.executed).toHaveLength(0);
  });

  it("executes multiple actions while the coordinate frame remains unchanged", async () => {
    const { page, session, frame } = await started();
    const result = await session.act({
      frameId: frame.id,
      actions: [
        { type: "move", x: 500, y: 300 },
        { type: "wait", durationMs: 25 },
        { type: "move", x: 520, y: 310 },
      ],
    });

    expect(result).toMatchObject({ ok: true, executedActions: 3, boundary: "unchanged" });
    expect(page.executed).toHaveLength(3);
  });

  it("ends a batch at a popup boundary and returns a fresh frame", async () => {
    const { page, session, frame } = await started();
    const result = await session.act({
      frameId: frame.id,
      actions: [
        { type: "click", x: 120, y: 80 },
        { type: "keypress", keys: ["K", "I", "A", "ENTER"] },
        { type: "click", x: 300, y: 80 },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      executedActions: 1,
      boundary: "popup_opened",
      frame: { id: "frame-2" },
    });
    expect(page.executed).toHaveLength(1);
  });

  it("rejects stale or invalid batches before any browser side effect", async () => {
    const { page, session } = await started();
    const stale = await session.act({
      frameId: "frame-stale",
      actions: [{ type: "click", x: 120, y: 80 }],
    });
    const invalid = await session.act({
      frameId: "frame-1",
      actions: [{ type: "click", x: 800, y: 80 }],
    });

    expect(stale).toMatchObject({ ok: false, executedActions: 0, code: "stale_frame" });
    expect(invalid).toMatchObject({ ok: false, executedActions: 0, code: "invalid_action_batch" });
    expect(page.executed).toHaveLength(0);
  });

  it("stops at an anti-bot challenge without inspecting or executing another action", async () => {
    const { page, session, frame } = await started();

    const result = await session.act({
      frameId: frame.id,
      actions: [
        { type: "click", x: 700, y: 80 },
        { type: "click", x: 300, y: 80 },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      code: "anti_bot_challenge",
      executedActions: 1,
      failedActionIndex: 0,
      frame: { id: "frame-2" },
    });
    expect(page.executed).toHaveLength(1);
    expect(
      await session.act({
        frameId: "frame-2",
        actions: [{ type: "click", x: 300, y: 80 }],
      }),
    ).toMatchObject({ ok: false, code: "anti_bot_challenge", executedActions: 0 });
    expect(page.executed).toHaveLength(1);
  });

  it("invalidates a cached frame when the page moves before the next action", async () => {
    const { page, session, frame } = await started();
    page.shiftLayout();

    const result = await session.act({
      frameId: frame.id,
      actions: [{ type: "click", x: 300, y: 80 }],
    });

    expect(result).toMatchObject({ ok: false, executedActions: 0, code: "stale_frame" });
    expect(page.executed).toHaveLength(0);
  });

  it("records an exact public native option change as semantic replay intent", async () => {
    const { session, frame } = await started();
    const opened = await session.act({
      frameId: frame.id,
      actions: [{ type: "click", x: 120, y: 80 }],
    });
    if (!opened.ok || opened.frame === undefined) throw new Error("popup frame missing");
    const selected = await session.act({
      frameId: opened.frame.id,
      actions: [{ type: "keypress", keys: ["K", "I", "A", "ENTER"] }],
    });

    expect(selected).toMatchObject({ ok: true, executedActions: 1 });
    expect(session.durableTrace().at(-1)).toMatchObject({
      semanticAction: { kind: "select", targetId: "target-make", optionLabel: "Kia" },
    });
  });

  it("keeps typed values transient while retaining their replay binding", async () => {
    const secret = "Sorento private runtime value";
    const { session, frame } = await started();
    const result = await session.act({
      frameId: frame.id,
      actions: [
        { type: "click", x: 300, y: 80 },
        { type: "type", text: secret, binding: "model" },
      ],
    });

    expect(result).toMatchObject({ ok: true, executedActions: 2 });
    expect(session.runtimeBindings()).toEqual({ model: secret });
    expect(JSON.stringify(session.durableTrace())).not.toContain(secret);
    expect(session.durableTrace().at(-1)).toMatchObject({
      semanticAction: {
        kind: "type",
        targetId: "target-model",
        inputBinding: "model",
        valueClass: "demo-data",
      },
    });
  });
});
