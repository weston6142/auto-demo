import { describe, expect, it } from "vitest";
import {
  createDiscoveryObservationExtractor,
  createDiscoverySession,
  recordDiscoveryObservation,
  type DiscoveryObservationPage,
} from "./index.js";
import { createDiscoveryObservationExtractorWithRegistry } from "./discoveryObservation.js";
import { createDiscoveryTargetRegistry } from "./discoveryTargetRegistry.js";

function safePage(): DiscoveryObservationPage {
  return {
    async isAvailable() {
      return true;
    },
    async readDocumentToken() {
      return "document-1";
    },
    async collectSnapshot() {
      return {
        documentToken: "document-1",
        url: "https://example.com/checkout",
        title: "Checkout",
        viewport: { width: 1280, height: 720 },
        canGoBack: false,
        visibleStates: [
          { identityKey: "text-cart", kind: "heading" as const, summary: "Your cart", order: 1 },
        ],
        interactiveTargets: [
          {
            identityKey: "element-checkout",
            tier: "semantic" as const,
            label: "Checkout",
            role: "button",
            order: 2,
            disabled: false,
            credential: false,
          },
        ],
      };
    },
    async captureViewportPng() {
      return new Uint8Array([1, 2, 3]);
    },
    async hasLiveIdentity(identityKey, documentToken) {
      return identityKey === "element-checkout" && documentToken === "document-1";
    },
  };
}

describe("createDiscoveryObservationExtractor", () => {
  it("returns an observation accepted by the discovery session lifecycle", async () => {
    const ids = ["observation-1", "target-checkout", "visible-cart"];
    const extractor = createDiscoveryObservationExtractor({
      page: safePage(),
      clock: () => "2026-07-14T12:00:01.000Z",
      idGenerator: () => ids.shift() ?? "unexpected-id",
    });

    const extracted = await extractor.observe();
    expect(extracted).toEqual({
      ok: true,
      observation: {
        id: "observation-1",
        observedAt: "2026-07-14T12:00:01.000Z",
        page: {
          url: "https://example.com/checkout",
          title: "Checkout",
          viewport: { width: 1280, height: 720 },
          navigation: { canGoBack: false },
        },
        visibleStates: [{ id: "visible-cart", kind: "text", summary: "Your cart" }],
        interactiveTargets: [
          { id: "target-checkout", label: "Checkout", role: "button", disabled: false },
        ],
        artifacts: [],
      },
      diagnostics: [],
    });

    const created = createDiscoverySession({
      id: "session-1",
      target: { kind: "browser", startUrl: "https://example.com/checkout" },
      goal: "Show checkout",
      host: { name: "codex", version: "1.0.0" },
      createdAt: "2026-07-14T12:00:00.000Z",
    });
    if (!created.ok || !extracted.ok) throw new Error("fixtures must be valid");
    expect(recordDiscoveryObservation(created.session, extracted.observation)).toMatchObject({
      ok: true,
      session: { observations: [{ id: "observation-1", sequence: 1 }] },
    });
  });

  it("retains target risk only in the runtime registry", async () => {
    const page = safePage();
    page.readDocumentToken = async () => "document-sensitive";
    page.collectSnapshot = async () => ({
      documentToken: "document-sensitive",
      url: "https://example.com/checkout",
      title: "Checkout",
      viewport: { width: 1280, height: 720 },
      canGoBack: false,
      visibleStates: [],
      interactiveTargets: [
        {
          identityKey: "element-sensitive",
          tier: "semantic",
          label: "Card number",
          role: "textbox",
          order: 1,
          disabled: false,
          credential: false,
          sensitivePayment: true,
          upload: false,
        },
      ],
    });
    const registry = createDiscoveryTargetRegistry(() => "target-sensitive");
    const extractor = createDiscoveryObservationExtractorWithRegistry(
      {
        page,
        clock: () => "2026-07-15T12:00:00.000Z",
        idGenerator: (kind) => `${kind}-1`,
      },
      registry,
    );

    const result = await extractor.observe();
    if (!result.ok) throw new Error("observation must succeed");
    const target = result.observation.interactiveTargets[0]!;

    expect(target).not.toHaveProperty("credential");
    expect(target).not.toHaveProperty("sensitivePayment");
    expect(target).not.toHaveProperty("upload");
    expect(registry.resolve(target.id)).toMatchObject({
      risk: { credential: false, sensitivePayment: true, upload: false },
    });
  });

  it("sanitizes content and prioritizes semantic targets before fallbacks", async () => {
    const page = safePage();
    page.collectSnapshot = async () => ({
      documentToken: "document-1",
      url: "https://example.com/checkout",
      title: "Checkout token=abcdefghijklmnopqrstuvwx1234",
      viewport: { width: 1280, height: 720 },
      canGoBack: false,
      visibleStates: [
        {
          identityKey: "text-1",
          kind: "text",
          summary: "token=abcdefghijklmnopqrstuvwx1234",
          order: 1,
        },
        { identityKey: "status-1", kind: "status", summary: "Ready", order: 2 },
      ],
      interactiveTargets: [
        {
          identityKey: "fallback-1",
          tier: "fallback",
          label: "Card",
          order: 1,
          disabled: false,
          credential: false,
        },
        {
          identityKey: "semantic-1",
          tier: "semantic",
          label: "Submit",
          role: "button",
          order: 2,
          disabled: false,
          credential: true,
          actionRisk: "potentially-mutating",
        },
      ],
    });
    const ids = ["observation-1", "target-1", "target-2", "visible-1", "visible-2"];
    const result = await createDiscoveryObservationExtractor({
      page,
      clock: () => "2026-07-14T12:00:01.000Z",
      idGenerator: () => ids.shift() ?? "unexpected-id",
    }).observe();

    expect(result).toMatchObject({
      ok: true,
      observation: {
        page: { title: expect.stringContaining("[redacted-secret]") },
        visibleStates: expect.arrayContaining([
          { id: expect.any(String), kind: "status", summary: "Ready" },
          {
            id: expect.any(String),
            kind: "text",
            summary: expect.stringContaining("[redacted-secret]"),
          },
        ]),
        interactiveTargets: [
          { label: "Submit", role: "button", actionRisk: "potentially-mutating" },
          { label: "Card" },
        ],
      },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "content_redacted" }),
        expect.objectContaining({ code: "credential_target_present", count: 1 }),
        expect.objectContaining({ code: "fallback_targets_included", count: 1 }),
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("abcdefghijklmnopqrstuvwx1234");
  });

  it("reports omitted target and visible-state counts without returning omitted content", async () => {
    const page = safePage();
    page.collectSnapshot = async () => ({
      documentToken: "document-1",
      url: "https://example.com",
      title: "Example",
      viewport: { width: 1280, height: 720 },
      canGoBack: false,
      visibleStates: Array.from({ length: 51 }, (_, index) => ({
        identityKey: `visible-${index}`,
        kind: "text" as const,
        summary: `Visible ${index}`,
        order: index,
      })),
      interactiveTargets: Array.from({ length: 101 }, (_, index) => ({
        identityKey: `target-${index}`,
        tier: "semantic" as const,
        label: `Target ${index}`,
        role: "button",
        order: index,
        disabled: false,
        credential: false,
      })),
    });
    const result = await createDiscoveryObservationExtractor({ page }).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: { visibleStates: { length: 50 }, interactiveTargets: { length: 100 } },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "visible_states_truncated", count: 1 }),
        expect.objectContaining({ code: "interactive_targets_truncated", count: 1 }),
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("Target 100");
    expect(JSON.stringify(result)).not.toContain("Visible 50");
  });

  it("prioritizes statuses and headings before text and keeps the highest-priority duplicate", async () => {
    const page = safePage();
    page.collectSnapshot = async () => ({
      ...(await safePage().collectSnapshot()),
      visibleStates: [
        { identityKey: "text-duplicate", kind: "text", summary: "Duplicate", order: 0 },
        ...Array.from({ length: 50 }, (_, index) => ({
          identityKey: `text-${index}`,
          kind: "text" as const,
          summary: `Text ${index}`,
          order: index + 1,
        })),
        { identityKey: "heading", kind: "heading", summary: "Important heading", order: 60 },
        { identityKey: "status", kind: "status", summary: "Duplicate", order: 61 },
      ],
    });
    const result = await createDiscoveryObservationExtractor({ page }).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        visibleStates: [
          expect.objectContaining({ kind: "status", summary: "Duplicate" }),
          expect.objectContaining({ kind: "text", summary: "Important heading" }),
          ...Array.from({ length: 48 }, () => expect.any(Object)),
        ],
      },
    });
    if (!result.ok) throw new Error("priority observation must succeed");
    expect(result.observation.visibleStates).toHaveLength(50);
  });

  it("retries one document replacement and reports the retry", async () => {
    const page = safePage();
    const tokens = ["document-1", "document-2", "document-2", "document-2"];
    page.readDocumentToken = async () => tokens.shift() ?? "document-2";
    page.collectSnapshot = async () => ({
      ...(await safePage().collectSnapshot()),
      documentToken: tokens.length >= 2 ? "document-1" : "document-2",
    });
    const result = await createDiscoveryObservationExtractor({ page }).observe();
    expect(result).toMatchObject({
      ok: true,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "unstable_page_retried", count: 1 }),
      ]),
    });
  });

  it("fails without partial output when both document attempts are unstable", async () => {
    const page = safePage();
    let token = 0;
    page.readDocumentToken = async () => `document-${++token}`;
    await expect(createDiscoveryObservationExtractor({ page }).observe()).resolves.toEqual({
      ok: false,
      errors: [{ code: "unstable_page", message: "Discovery page changed during observation." }],
    });
  });

  it("keeps attached target ids stable and invalidates removed targets", async () => {
    const page = safePage();
    let live = true;
    page.hasLiveIdentity = async () => live;
    const ids = ["observation-1", "target-stable", "visible-1", "observation-2", "visible-2"];
    const extractor = createDiscoveryObservationExtractor({
      page,
      idGenerator: () => ids.shift() ?? "unexpected-id",
    });
    const first = await extractor.observe();
    const second = await extractor.observe();
    expect(first.ok && first.observation.interactiveTargets[0]?.id).toBe("target-stable");
    expect(second.ok && second.observation.interactiveTargets[0]?.id).toBe("target-stable");
    expect(await extractor.hasLiveTarget("target-stable")).toBe(true);
    live = false;
    expect(await extractor.hasLiveTarget("target-stable")).toBe(false);
  });

  it("returns fixed structured failures without partial or exception-secret output", async () => {
    const unavailable = safePage();
    unavailable.isAvailable = async () => false;

    const availabilityFailure = safePage();
    availabilityFailure.isAvailable = async () => {
      throw new Error("availability-secret");
    };

    const thrown = safePage();
    thrown.collectSnapshot = async () => {
      throw new Error("injected-exception-secret");
    };

    const unsafeUrl = safePage();
    unsafeUrl.collectSnapshot = async () => ({
      ...(await safePage().collectSnapshot()),
      url: "javascript:injected-exception-secret",
    });

    const invalidViewport = safePage();
    invalidViewport.collectSnapshot = async () => ({
      ...(await safePage().collectSnapshot()),
      viewport: { width: 0, height: 720 },
    });

    const emptyTitle = safePage();
    emptyTitle.collectSnapshot = async () => ({
      ...(await safePage().collectSnapshot()),
      title: "   ",
    });

    const cases = [
      { page: unavailable, code: "browser_unavailable" },
      { page: availabilityFailure, code: "browser_unavailable" },
      { page: thrown, code: "page_evaluation_failed" },
      { page: unsafeUrl, code: "unsafe_page_url" },
      { page: invalidViewport, code: "invalid_page_state" },
      { page: emptyTitle, code: "invalid_page_state" },
    ] as const;

    for (const testCase of cases) {
      const result = await createDiscoveryObservationExtractor({ page: testCase.page }).observe();
      expect(result).toMatchObject({
        ok: false,
        errors: [{ code: testCase.code }],
      });
      expect(result).not.toHaveProperty("observation");
      expect(JSON.stringify(result)).not.toMatch(/injected-exception-secret|availability-secret/);
    }
  });

  it("rejects invalid injected times and ids before returning an observation", async () => {
    const cases = [
      { clock: () => "not-a-time", idGenerator: undefined },
      { clock: undefined, idGenerator: () => "../unsafe-id" },
      { clock: undefined, idGenerator: () => "duplicate-id" },
    ] as const;
    for (const testCase of cases) {
      const result = await createDiscoveryObservationExtractor({
        page: safePage(),
        ...(testCase.clock === undefined ? {} : { clock: testCase.clock }),
        ...(testCase.idGenerator === undefined ? {} : { idGenerator: testCase.idGenerator }),
      }).observe();
      expect(result).toEqual({
        ok: false,
        errors: [
          {
            code: "invalid_page_state",
            message: "Discovery page state is invalid.",
            path: "observation",
          },
        ],
      });
    }
  });

  it("validates the observation and artifact id before persisting screenshot bytes", async () => {
    for (const ids of [
      ["observation-1", "target-1", "visible-1", "../unsafe-artifact"],
      ["observation-1", "target-1", "visible-1", "target-1"],
    ]) {
      let writes = 0;
      const result = await createDiscoveryObservationExtractor({
        page: safePage(),
        idGenerator: () => ids.shift() ?? "unexpected-id",
        artifactSink: {
          async write() {
            writes += 1;
            return { path: "artifacts/page.png" };
          },
        },
      }).observe();
      expect(result).toMatchObject({
        ok: false,
        errors: [{ code: "invalid_page_state", path: "observation" }],
      });
      expect(writes).toBe(0);
    }
  });

  it("persists an optional screenshot as a safe hashed artifact reference", async () => {
    const writes: Array<{ id: string; bytes: Uint8Array; sha256: string }> = [];
    const page = safePage();
    const ids = ["observation-1", "target-1", "visible-1", "artifact-1"];
    const result = await createDiscoveryObservationExtractor({
      page,
      idGenerator: () => ids.shift() ?? "unexpected-id",
      artifactSink: {
        async write(input) {
          writes.push(input);
          return { path: "artifacts/observation-1.png" };
        },
      },
    }).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: {
        artifacts: [
          {
            id: "artifact-1",
            kind: "screenshot",
            path: "artifacts/observation-1.png",
            mediaType: "image/png",
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
          },
        ],
      },
    });
    expect(writes).toHaveLength(1);
    expect(Array.from(writes[0]?.bytes ?? [])).toEqual([1, 2, 3]);
    expect(JSON.stringify(result)).not.toContain("1,2,3");
  });

  it("does not capture a screenshot when no artifact sink is configured", async () => {
    const page = safePage();
    let captures = 0;
    page.captureViewportPng = async () => {
      captures += 1;
      return new Uint8Array([1, 2, 3]);
    };
    const result = await createDiscoveryObservationExtractor({ page }).observe();
    expect(result).toMatchObject({ ok: true, observation: { artifacts: [] }, diagnostics: [] });
    expect(captures).toBe(0);
  });

  it("degrades capture and sink failures to screenshot diagnostics", async () => {
    const captureFailurePage = safePage();
    captureFailurePage.captureViewportPng = async () => {
      throw new Error("capture-secret");
    };
    const captureFailure = await createDiscoveryObservationExtractor({
      page: captureFailurePage,
      artifactSink: {
        async write() {
          return { path: "artifacts/unused.png" };
        },
      },
    }).observe();

    const sinkFailure = await createDiscoveryObservationExtractor({
      page: safePage(),
      artifactSink: {
        async write() {
          throw new Error("sink-secret");
        },
      },
    }).observe();

    for (const result of [captureFailure, sinkFailure]) {
      expect(result).toMatchObject({
        ok: true,
        observation: { artifacts: [] },
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: "screenshot_unavailable", count: 1 }),
        ]),
      });
      expect(JSON.stringify(result)).not.toMatch(/capture-secret|sink-secret/);
    }
  });

  it("rejects an unsafe screenshot sink path without exposing it", async () => {
    const result = await createDiscoveryObservationExtractor({
      page: safePage(),
      artifactSink: {
        async write() {
          return { path: "../secret.png" };
        },
      },
    }).observe();
    expect(result).toMatchObject({
      ok: true,
      observation: { artifacts: [] },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "screenshot_unavailable", count: 1 }),
      ]),
    });
    expect(JSON.stringify(result)).not.toContain("../secret.png");

    const overlongPath = `artifacts/${"a".repeat(2_100)}.png`;
    const overlong = await createDiscoveryObservationExtractor({
      page: safePage(),
      artifactSink: {
        async write() {
          return { path: overlongPath };
        },
      },
    }).observe();
    expect(overlong).toMatchObject({
      ok: true,
      observation: { artifacts: [] },
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "screenshot_unavailable", count: 1 }),
      ]),
    });
    expect(JSON.stringify(overlong)).not.toContain(overlongPath);
  });
});
