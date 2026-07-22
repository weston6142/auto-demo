import { describe, expect, it } from "vitest";
import {
  COORDINATE_DISCOVERY_LIMITS,
  parseCoordinateActionBatch,
} from "./coordinateDiscoveryContract.js";

const viewport = { width: 1280, height: 720 };

describe("coordinate discovery action contract", () => {
  it("accepts every provider-neutral coordinate action in declaration order", () => {
    expect(
      parseCoordinateActionBatch(
        {
          frameId: "frame-1",
          actions: [
            { type: "move", x: 10, y: 20 },
            { type: "click", x: 420, y: 245 },
            { type: "double-click", x: 500, y: 300 },
            { type: "scroll", x: 600, y: 400, deltaX: 0, deltaY: 500 },
            { type: "keypress", keys: ["K", "I", "A", "ENTER"] },
            { type: "type", text: "Sorento", binding: "model" },
            { type: "wait", durationMs: 250 },
          ],
        },
        viewport,
      ),
    ).toEqual({
      ok: true,
      batch: {
        frameId: "frame-1",
        actions: [
          { type: "move", x: 10, y: 20 },
          { type: "click", x: 420, y: 245 },
          { type: "double-click", x: 500, y: 300 },
          { type: "scroll", x: 600, y: 400, deltaX: 0, deltaY: 500 },
          { type: "keypress", keys: ["K", "I", "A", "ENTER"] },
          { type: "type", text: "Sorento", binding: "model" },
          { type: "wait", durationMs: 250 },
        ],
      },
    });
  });

  it.each([
    { name: "stale-shaped frame", value: { frameId: "../frame-1", actions: [] } },
    { name: "unknown field", value: { frameId: "frame-1", actions: [], provider: "codex" } },
    {
      name: "out-of-bounds coordinate",
      value: { frameId: "frame-1", actions: [{ type: "click", x: 1280, y: 10 }] },
    },
    {
      name: "unsupported key",
      value: { frameId: "frame-1", actions: [{ type: "keypress", keys: ["F12"] }] },
    },
    {
      name: "unknown action field",
      value: { frameId: "frame-1", actions: [{ type: "wait", durationMs: 10, secret: true }] },
    },
  ])("rejects $name without returning executable actions", ({ value }) => {
    const result = parseCoordinateActionBatch(value, viewport);
    expect(result).toMatchObject({ ok: false, errors: [{ code: "invalid_action_batch" }] });
    expect("batch" in result).toBe(false);
  });

  it("bounds action count, wheel distance, wait duration, and transient text", () => {
    const values = [
      {
        frameId: "frame-1",
        actions: Array.from({ length: COORDINATE_DISCOVERY_LIMITS.actionsPerBatch + 1 }, () => ({
          type: "wait",
          durationMs: 1,
        })),
      },
      {
        frameId: "frame-1",
        actions: [
          { type: "scroll", x: 1, y: 1, deltaY: COORDINATE_DISCOVERY_LIMITS.wheelDelta + 1 },
        ],
      },
      {
        frameId: "frame-1",
        actions: [{ type: "wait", durationMs: COORDINATE_DISCOVERY_LIMITS.waitDurationMs + 1 }],
      },
      {
        frameId: "frame-1",
        actions: [
          { type: "type", text: "x".repeat(COORDINATE_DISCOVERY_LIMITS.typeCharacters + 1) },
        ],
      },
    ];

    for (const value of values) {
      expect(parseCoordinateActionBatch(value, viewport)).toMatchObject({
        ok: false,
        errors: [{ code: "invalid_action_batch" }],
      });
    }
  });

  it("reports only a bounded action index and never echoes transient text", () => {
    const secret = "private runtime value";
    const result = parseCoordinateActionBatch(
      {
        frameId: "frame-1",
        actions: [{ type: "type", text: secret, binding: "not safe!" }],
      },
      viewport,
    );

    expect(result).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_action_batch", actionIndex: 0 }],
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
