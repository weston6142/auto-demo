import { readFile } from "node:fs/promises";
import type { BrowserLaunchProfileV1 } from "@auto-demo/browser-profile";
import { describe, expect, it } from "vitest";
import {
  approveWalkthroughPlan,
  compileDiscoverySessionToWalkthroughPlan,
  createChildDiscoverySession,
  createDiscoverySession,
  isWalkthroughPlan,
  validateDiscoverySession,
  verifyWalkthroughPlanApproval,
  type DiscoverySessionV1,
} from "./index.js";
import { legacyWalkthroughPlanFixture } from "./walkthroughTestFixtures.js";

const chromeHeadful: BrowserLaunchProfileV1 = {
  schemaVersion: 1,
  browser: "chromium",
  channel: "chrome",
  headless: false,
  viewport: { width: 1440, height: 900 },
};

const bundledHeadless: BrowserLaunchProfileV1 = {
  schemaVersion: 1,
  browser: "chromium",
  channel: "bundled",
  headless: true,
  viewport: { width: 1280, height: 720 },
};

async function completedSession(): Promise<DiscoverySessionV1> {
  const raw = await readFile(
    new URL("../fixtures/discovery-session-completed.json", import.meta.url),
    "utf8",
  );
  return JSON.parse(raw) as DiscoverySessionV1;
}

describe("browser launch profiles in discovery artifacts", () => {
  it("validates and normalizes an explicit profile when a session starts", () => {
    const result = createDiscoverySession({
      id: "profile-session",
      target: { kind: "browser", startUrl: "https://example.com/search" },
      goal: "Find one vehicle",
      host: { name: "codex", version: "1" },
      launchProfile: chromeHeadful,
      createdAt: "2026-07-19T12:00:00.000Z",
    });

    expect(result).toMatchObject({ ok: true, session: { launchProfile: chromeHeadful } });
  });

  it("rejects unknown profile fields at session boundaries", async () => {
    const session = await completedSession();
    const invalid = {
      ...session,
      launchProfile: { ...chromeHeadful, storageState: "authenticated.json" },
    };

    expect(validateDiscoverySession(invalid)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_session" }],
    });
  });

  it("preserves the selected profile through compilation and sanitization", async () => {
    const session = { ...(await completedSession()), launchProfile: chromeHeadful };
    const validated = validateDiscoverySession(session);
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error("profile session should validate");

    const compiled = compileDiscoverySessionToWalkthroughPlan(validated.session);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("profile session should compile");
    expect(compiled.plan.launchProfile).toEqual(chromeHeadful);
    expect(isWalkthroughPlan(compiled.plan)).toBe(true);
  });

  it("makes the selected profile part of approval freshness", async () => {
    const plan = legacyWalkthroughPlanFixture({
      targetUrl: "https://example.com/search",
      script: "Click Get started.",
      mode: "best-guess",
    });
    plan.launchProfile = chromeHeadful;
    const approved = approveWalkthroughPlan(plan, {
      allowBestGuessBypass: true,
      now: () => new Date("2026-07-19T12:06:00.000Z"),
    });
    if (!approved.ok) throw new Error(JSON.stringify(approved.errors));
    expect(approved.ok).toBe(true);

    approved.plan.launchProfile = bundledHeadless;
    expect(verifyWalkthroughPlanApproval(approved.plan)).toMatchObject({
      ok: false,
      errors: [{ code: "stale_approval" }],
    });
  });

  it("requires child discovery to keep the terminal parent profile", async () => {
    const parent = { ...(await completedSession()), launchProfile: chromeHeadful };
    const child = createChildDiscoverySession(parent, {
      id: "profile-child",
      target: { kind: "browser", startUrl: parent.target.startUrl },
      goal: parent.goal,
      host: parent.host,
      launchProfile: chromeHeadful,
      createdAt: "2026-07-19T12:10:00.000Z",
    });
    expect(child).toMatchObject({ ok: true, session: { launchProfile: chromeHeadful } });

    expect(
      createChildDiscoverySession(parent, {
        id: "profile-drift-child",
        target: { kind: "browser", startUrl: parent.target.startUrl },
        goal: parent.goal,
        host: parent.host,
        launchProfile: bundledHeadless,
        createdAt: "2026-07-19T12:10:00.000Z",
      }),
    ).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_discovery_transition" }],
    });
  });

  it("keeps historical profile-free discovery fixtures compatible", async () => {
    const session = await completedSession();
    expect(session.launchProfile).toBeUndefined();
    expect(validateDiscoverySession(session).ok).toBe(true);
    const compiled = compileDiscoverySessionToWalkthroughPlan(session);
    expect(compiled.ok && compiled.plan.launchProfile).toBeUndefined();
  });
});
