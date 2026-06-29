import { describe, expect, it } from "vitest";
import {
  classifyCapturedValue,
  createCaptureEventFactory,
  redactCapturedValue,
  type CaptureEvent,
} from "./captureEvents.js";

describe("createCaptureEventFactory", () => {
  it("creates ordered events with timestamps relative to capture start", () => {
    const factory = createCaptureEventFactory({
      captureStartedAt: new Date("2026-06-29T12:00:00.000Z"),
      now: (() => {
        const dates = [new Date("2026-06-29T12:00:00.000Z"), new Date("2026-06-29T12:00:01.250Z")];
        return () => dates.shift() ?? new Date("2026-06-29T12:00:01.250Z");
      })(),
    });

    const first = factory.create("capture_started", {
      pageUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
    });
    const second = factory.create("navigation", {
      pageUrl: "https://example.com/dashboard",
      data: { phase: "load" },
    });

    expect(first).toMatchObject({
      id: "event-1",
      sequence: 1,
      type: "capture_started",
      timestampMs: 0,
      pageUrl: "https://example.com",
      viewport: { width: 1280, height: 720 },
    } satisfies Partial<CaptureEvent>);
    expect(second).toMatchObject({
      id: "event-2",
      sequence: 2,
      type: "navigation",
      timestampMs: 1250,
      pageUrl: "https://example.com/dashboard",
      data: { phase: "load" },
    } satisfies Partial<CaptureEvent>);
  });
});

describe("classifyCapturedValue", () => {
  it.each([
    ["person@example.com", "email_like"],
    ["https://example.com/path", "url_like"],
    ["12345.67", "number_like"],
    ["hello", "short_text"],
    ["x".repeat(81), "long_text"],
    ["", "unknown"],
  ] as const)("classifies %s as %s", (value, expected) => {
    expect(classifyCapturedValue({ value, inputType: "text" })).toBe(expected);
  });

  it("treats password fields as password regardless of value shape", () => {
    expect(classifyCapturedValue({ value: "person@example.com", inputType: "password" })).toBe(
      "password",
    );
  });
});

describe("redactCapturedValue", () => {
  it("redacts typed values while keeping useful coarse metadata", () => {
    expect(redactCapturedValue({ value: "person@example.com", inputType: "email" })).toEqual({
      redacted: true,
      valueKind: "email_like",
      valueLength: 18,
    });
  });

  it("omits exact password length", () => {
    expect(redactCapturedValue({ value: "secret-password", inputType: "password" })).toEqual({
      redacted: true,
      valueKind: "password",
    });
  });
});
