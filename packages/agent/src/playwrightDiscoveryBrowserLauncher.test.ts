import { browserLaunchProfileId, type BrowserLaunchProfileV1 } from "@auto-demo/browser-profile";
import type { Page } from "playwright";
import { describe, expect, it } from "vitest";
import {
  createPlaywrightDiscoveryBrowserLauncherForDriver,
  type DiscoveryBrowserLauncherDriver,
} from "./playwrightDiscoveryBrowserLauncher.js";

const bundledHeadless: BrowserLaunchProfileV1 = {
  schemaVersion: 1,
  browser: "chromium",
  channel: "bundled",
  headless: true,
  viewport: { width: 1280, height: 720 },
};

const chromeHeadful: BrowserLaunchProfileV1 = {
  schemaVersion: 1,
  browser: "chromium",
  channel: "chrome",
  headless: false,
  viewport: { width: 1440, height: 900 },
};

type AttemptBehavior =
  | { outcome: "launch-failure"; secret: string }
  | { outcome: "navigation-failure"; secret: string }
  | { outcome: "challenge"; title: string; text: string }
  | { outcome: "success"; title?: string; text?: string };

class FakeDriver implements DiscoveryBrowserLauncherDriver {
  readonly launches: BrowserLaunchProfileV1[] = [];
  readonly resources: Array<{ contextClosed: boolean; browserClosed: boolean }> = [];

  constructor(private readonly behaviors: AttemptBehavior[]) {}

  async launch(profile: BrowserLaunchProfileV1) {
    const behavior = this.behaviors[this.launches.length];
    this.launches.push(structuredClone(profile));
    if (behavior?.outcome === "launch-failure") throw new Error(behavior.secret);
    const resource = { contextClosed: false, browserClosed: false };
    this.resources.push(resource);
    return {
      async newContext(options: { viewport: { width: number; height: number } }) {
        expect(options.viewport).toEqual(profile.viewport);
        return {
          async newPage() {
            return {
              raw: {} as Page,
              observeMainDocumentResponses() {
                return () => undefined;
              },
              async goto() {
                if (behavior?.outcome === "navigation-failure") throw new Error(behavior.secret);
              },
              async challengeSummary() {
                if (behavior?.outcome === "challenge") {
                  return { title: behavior.title, visibleText: behavior.text };
                }
                return {
                  title: behavior?.outcome === "success" ? (behavior.title ?? "Ready") : "Ready",
                  visibleText:
                    behavior?.outcome === "success" ? (behavior.text ?? "Search inventory") : "",
                };
              },
            };
          },
          async close() {
            resource.contextClosed = true;
          },
        };
      },
      async close() {
        resource.browserClosed = true;
      },
    };
  }
}

class DiagnosticFallbackDriver implements DiscoveryBrowserLauncherDriver {
  readonly detached = [false, false];
  private attemptIndex = 0;

  async launch() {
    const attemptIndex = this.attemptIndex++;
    const detached = this.detached;
    let listener: ((response: { status: number; url: string }) => void) | undefined;
    return {
      async newContext() {
        return {
          async newPage() {
            return {
              raw: {} as Page,
              observeMainDocumentResponses(
                next: (response: { status: number; url: string }) => void,
              ) {
                listener = next;
                return () => {
                  listener = undefined;
                  detached[attemptIndex] = true;
                };
              },
              async goto() {
                listener?.({
                  status: attemptIndex === 0 ? 403 : 200,
                  url:
                    attemptIndex === 0
                      ? "https://blocked.example/private?token=first-secret"
                      : "https://example.com/private?token=second-secret",
                });
                if (attemptIndex === 0) throw new Error("first-navigation-secret");
              },
              async challengeSummary() {
                return { title: "Ready", visibleText: "Search inventory" };
              },
            };
          },
          async close() {},
        };
      },
      async close() {},
    };
  }
}

describe("Playwright discovery browser launcher", () => {
  it("observes main-document responses before navigation completes and detaches on close", async () => {
    const observed: Array<{ ordinal: number; profileId: string; status: number; url: string }> = [];
    let listener: ((response: { status: number; url: string }) => void) | undefined;
    let detached = false;
    const driver: DiscoveryBrowserLauncherDriver = {
      async launch() {
        return {
          async newContext() {
            return {
              async newPage() {
                return {
                  raw: {} as Page,
                  observeMainDocumentResponses(next) {
                    listener = next;
                    return () => {
                      detached = true;
                      listener = undefined;
                    };
                  },
                  async goto() {
                    listener?.({
                      status: 403,
                      url: "https://blocked.example/private?token=navigation-secret",
                    });
                  },
                  async challengeSummary() {
                    return { title: "Ready", visibleText: "Search inventory" };
                  },
                };
              },
              async close() {},
            };
          },
          async close() {},
        };
      },
    };

    const result = await createPlaywrightDiscoveryBrowserLauncherForDriver(driver).launch({
      url: "https://example.com",
      profilePlan: { schemaVersion: 1, primary: bundledHeadless },
      onMainDocumentResponse(response) {
        observed.push(structuredClone(response));
      },
    });

    expect(result.ok).toBe(true);
    expect(observed).toEqual([
      {
        ordinal: 1,
        profileId: browserLaunchProfileId(bundledHeadless),
        status: 403,
        url: "https://blocked.example/private?token=navigation-secret",
      },
    ]);
    expect(detached).toBe(false);
    if (result.ok) await result.close();
    expect(detached).toBe(true);
  });

  it("emits causally ordered attempt identity across a failed profile and fallback", async () => {
    const driver = new DiagnosticFallbackDriver();
    const events: string[] = [];
    const result = await createPlaywrightDiscoveryBrowserLauncherForDriver(driver).launch({
      url: "https://example.com",
      profilePlan: {
        schemaVersion: 1,
        primary: bundledHeadless,
        fallbacks: [chromeHeadful],
      },
      onMainDocumentResponse(response) {
        events.push(`response:${response.ordinal}:${response.status}:${response.profileId}`);
      },
      onLaunchAttempt(attempt) {
        events.push(`attempt:${attempt.ordinal}:${attempt.outcome}:${attempt.profileId}`);
      },
    });

    expect(result.ok).toBe(true);
    expect(events).toEqual([
      `response:1:403:${browserLaunchProfileId(bundledHeadless)}`,
      `attempt:1:browser_navigation_failed:${browserLaunchProfileId(bundledHeadless)}`,
      `response:2:200:${browserLaunchProfileId(chromeHeadful)}`,
    ]);
    expect(driver.detached).toEqual([true, false]);
    if (result.ok) await result.close();
    expect(driver.detached).toEqual([true, true]);
  });

  it("falls back in declaration order and closes the challenged attempt", async () => {
    const driver = new FakeDriver([
      {
        outcome: "challenge",
        title: "Just a moment...",
        text: "Performing security verification with a security service to protect itself.",
      },
      { outcome: "success" },
    ]);

    const result = await createPlaywrightDiscoveryBrowserLauncherForDriver(driver).launch({
      url: "https://example.com/search",
      profilePlan: {
        schemaVersion: 1,
        primary: bundledHeadless,
        fallbacks: [chromeHeadful],
      },
    });

    expect(result).toMatchObject({
      ok: true,
      profile: chromeHeadful,
      attempts: [
        {
          ordinal: 1,
          outcome: "anti_bot_challenge",
          challenge: { provider: "cloudflare" },
        },
      ],
    });
    expect(driver.launches).toEqual([bundledHeadless, chromeHeadful]);
    expect(driver.resources[0]).toEqual({ contextClosed: true, browserClosed: true });
    expect(driver.resources[1]).toEqual({ contextClosed: false, browserClosed: false });
    if (!result.ok) throw new Error("expected launch success");
    await result.close();
    await result.close();
    expect(driver.resources[1]).toEqual({ contextClosed: true, browserClosed: true });
  });

  it("returns bounded sanitized evidence after exhausting three fresh attempts", async () => {
    const driver = new FakeDriver([
      { outcome: "launch-failure", secret: "launch-secret" },
      { outcome: "navigation-failure", secret: "navigation-secret" },
      {
        outcome: "challenge",
        title: "Verify you are human",
        text: "Complete the verification to continue with page-secret.",
      },
    ]);

    const result = await createPlaywrightDiscoveryBrowserLauncherForDriver(driver).launch({
      url: "https://example.com/search?token=url-secret",
      profilePlan: {
        schemaVersion: 1,
        primary: bundledHeadless,
        fallbacks: [chromeHeadful, { ...chromeHeadful, channel: "msedge" }],
      },
    });

    expect(result).toMatchObject({
      ok: false,
      code: "browser_profile_fallback_exhausted",
      attempts: [
        { ordinal: 1, outcome: "browser_launch_failed" },
        { ordinal: 2, outcome: "browser_navigation_failed" },
        {
          ordinal: 3,
          outcome: "anti_bot_challenge",
          challenge: { provider: "generic" },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /launch-secret|navigation-secret|page-secret|url-secret/,
    );
    expect(driver.resources).toEqual([
      { contextClosed: true, browserClosed: true },
      { contextClosed: true, browserClosed: true },
    ]);
  });

  it("rejects an invalid plan before browser launch", async () => {
    const driver = new FakeDriver([]);
    const result = await createPlaywrightDiscoveryBrowserLauncherForDriver(driver).launch({
      url: "https://example.com",
      profilePlan: {
        schemaVersion: 1,
        primary: { ...bundledHeadless, headless: "yes" },
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_browser_launch_profile",
      message: "Browser launch profile is invalid.",
      attempts: [],
    });
    expect(driver.launches).toEqual([]);
  });

  it("stops after the first usable profile", async () => {
    const driver = new FakeDriver([{ outcome: "success" }, { outcome: "success" }]);
    const result = await createPlaywrightDiscoveryBrowserLauncherForDriver(driver).launch({
      url: "https://example.com",
      profilePlan: {
        schemaVersion: 1,
        primary: bundledHeadless,
        fallbacks: [chromeHeadful],
      },
    });

    expect(result).toMatchObject({ ok: true, profile: bundledHeadless, attempts: [] });
    expect(driver.launches).toEqual([bundledHeadless]);
    if (result.ok) await result.close();
  });
});
