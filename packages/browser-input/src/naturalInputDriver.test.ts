import { describe, expect, it } from "vitest";
import {
  createNaturalInputDriver,
  type NaturalInputEvent,
  type NaturalInputPort,
} from "./index.js";

function recordingPort(events: NaturalInputEvent[]): NaturalInputPort {
  return {
    async move(point) {
      events.push({ kind: "move", point });
    },
    async down(button) {
      events.push({ kind: "down", button });
    },
    async up(button) {
      events.push({ kind: "up", button });
    },
    async wheel(deltaX, deltaY) {
      events.push({ kind: "wheel", deltaX, deltaY });
    },
    async keypress(key) {
      events.push({ kind: "keypress", key });
    },
    async type(text) {
      events.push({ kind: "type", text });
    },
    async wait(durationMs) {
      events.push({ kind: "wait", durationMs });
    },
  };
}

describe("natural browser input", () => {
  it("moves through a deterministic curved path and finishes exactly at the destination", async () => {
    const first: NaturalInputEvent[] = [];
    const second: NaturalInputEvent[] = [];
    const destination = { x: 420, y: 245 };

    const firstDriver = createNaturalInputDriver(recordingPort(first), {
      pointer: { x: 20, y: 30 },
    });
    const secondDriver = createNaturalInputDriver(recordingPort(second), {
      pointer: { x: 20, y: 30 },
    });
    await firstDriver.move(destination);
    await secondDriver.move(destination);

    expect(first).toEqual(second);
    const moves = first.filter((event) => event.kind === "move");
    expect(moves.length).toBeGreaterThan(2);
    expect(moves.at(-1)).toEqual({ kind: "move", point: destination });
    expect(firstDriver.pointer()).toEqual(destination);
    expect(moves.some((event) => event.point.x !== 20 && event.point.y !== 30)).toBe(true);
  });

  it("settles at the destination before a physical click", async () => {
    const events: NaturalInputEvent[] = [];
    const driver = createNaturalInputDriver(recordingPort(events), {
      pointer: { x: 20, y: 30 },
      settleMs: 40,
    });

    await driver.click({ x: 420, y: 245 });

    expect(events.at(-3)).toEqual({ kind: "wait", durationMs: 40 });
    expect(events.slice(-2)).toEqual([
      { kind: "down", button: "left" },
      { kind: "up", button: "left" },
    ]);
  });

  it("uses two physical click pairs for a double click", async () => {
    const events: NaturalInputEvent[] = [];
    const driver = createNaturalInputDriver(recordingPort(events), {
      pointer: { x: 0, y: 0 },
      settleMs: 0,
      doubleClickIntervalMs: 80,
    });

    await driver.doubleClick({ x: 10, y: 10 });

    expect(events.slice(-5)).toEqual([
      { kind: "down", button: "left" },
      { kind: "up", button: "left" },
      { kind: "wait", durationMs: 80 },
      { kind: "down", button: "left" },
      { kind: "up", button: "left" },
    ]);
  });

  it("moves and settles before sending a location-aware wheel event", async () => {
    const events: NaturalInputEvent[] = [];
    const driver = createNaturalInputDriver(recordingPort(events), {
      pointer: { x: 0, y: 0 },
      settleMs: 25,
    });

    await driver.scroll({ x: 90, y: 120 }, 3, 400);

    expect(events.at(-3)).toEqual({ kind: "move", point: { x: 90, y: 120 } });
    expect(events.at(-2)).toEqual({ kind: "wait", durationMs: 25 });
    expect(events.at(-1)).toEqual({ kind: "wheel", deltaX: 3, deltaY: 400 });
  });

  it("preserves keyboard action order and rejects invalid coordinates", async () => {
    const events: NaturalInputEvent[] = [];
    const driver = createNaturalInputDriver(recordingPort(events), {
      pointer: { x: 0, y: 0 },
    });

    await driver.keypress(["K", "I", "A", "ENTER"]);
    await driver.type("Sorento");

    expect(events).toEqual([
      { kind: "keypress", key: "K" },
      { kind: "keypress", key: "I" },
      { kind: "keypress", key: "A" },
      { kind: "keypress", key: "ENTER" },
      { kind: "type", text: "Sorento" },
    ]);
    await expect(driver.move({ x: Number.NaN, y: 1 })).rejects.toThrow("invalid coordinates");
  });
});
