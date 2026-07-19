import { describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_LAUNCH_PROFILE,
  browserLaunchProfileId,
  classifyBrowserChallenge,
  validateBrowserLaunchProfile,
  validateBrowserLaunchProfilePlan,
} from "./index.js";

const chromeHeadful = {
  schemaVersion: 1,
  browser: "chromium",
  channel: "chrome",
  headless: false,
  viewport: { width: 1440, height: 900 },
} as const;

describe("browser launch profile contract", () => {
  it("normalizes one supported public launch profile", () => {
    expect(validateBrowserLaunchProfile(chromeHeadful)).toEqual({
      ok: true,
      profile: chromeHeadful,
      profileId: browserLaunchProfileId(chromeHeadful),
    });
  });

  it.each([
    { ...chromeHeadful, executablePath: "/secret/browser" },
    { ...chromeHeadful, viewport: { width: 0, height: 900 } },
    { ...chromeHeadful, viewport: { width: 1440, height: 4097 } },
    { ...chromeHeadful, channel: "canary" },
    { ...chromeHeadful, browser: "firefox" },
  ])("rejects unsupported or unsafe profile shapes", (profile) => {
    expect(validateBrowserLaunchProfile(profile)).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_browser_launch_profile",
          message: "Browser launch profile is invalid.",
        },
      ],
    });
  });

  it("accepts a bounded unique fallback plan in declaration order", () => {
    const edgeHeadful = { ...chromeHeadful, channel: "msedge" as const };
    expect(
      validateBrowserLaunchProfilePlan({
        schemaVersion: 1,
        primary: DEFAULT_BROWSER_LAUNCH_PROFILE,
        fallbacks: [chromeHeadful, edgeHeadful],
      }),
    ).toMatchObject({
      ok: true,
      profiles: [DEFAULT_BROWSER_LAUNCH_PROFILE, chromeHeadful, edgeHeadful],
    });
  });

  it.each([
    {
      schemaVersion: 1,
      primary: chromeHeadful,
      fallbacks: [chromeHeadful],
    },
    {
      schemaVersion: 1,
      primary: DEFAULT_BROWSER_LAUNCH_PROFILE,
      fallbacks: [
        chromeHeadful,
        { ...chromeHeadful, channel: "msedge" },
        { ...chromeHeadful, headless: true },
      ],
    },
    {
      schemaVersion: 1,
      primary: chromeHeadful,
      fallbacks: [],
      storageState: "auth.json",
    },
  ])("rejects duplicate, excessive, or unknown fallback data", (plan) => {
    expect(validateBrowserLaunchProfilePlan(plan)).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_browser_launch_profile" }],
    });
  });

  it("classifies bounded Cloudflare and generic challenge marker combinations", () => {
    expect(
      classifyBrowserChallenge({
        title: "Just a moment...",
        visibleText:
          "Performing security verification. This website uses a security service to protect itself.",
      }),
    ).toEqual({ provider: "cloudflare" });
    expect(
      classifyBrowserChallenge({
        title: "Verify you are human",
        visibleText: "Complete the verification to continue.",
      }),
    ).toEqual({ provider: "generic" });
  });

  it("does not classify an ordinary page from one weak marker", () => {
    expect(
      classifyBrowserChallenge({
        title: "Just a moment...",
        visibleText: "Ordinary product copy with no verification controls.",
      }),
    ).toBeUndefined();
    expect(
      classifyBrowserChallenge({
        title: "Vehicle results",
        visibleText: "Verify the model year in the listing details.",
      }),
    ).toBeUndefined();
  });
});
