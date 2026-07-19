import {
  browserLaunchProfileId,
  classifyBrowserChallenge,
  validateBrowserLaunchProfilePlan,
  type BrowserChallenge,
  type BrowserLaunchProfileV1,
} from "@auto-demo/browser-profile";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type DiscoveryBrowserLaunchAttempt = {
  ordinal: 1 | 2 | 3;
  profileId: string;
  outcome: "browser_launch_failed" | "browser_navigation_failed" | "anti_bot_challenge";
  challenge?: BrowserChallenge;
};

export type DiscoveryBrowserLaunchHandle = {
  ok: true;
  page: Page;
  profile: BrowserLaunchProfileV1;
  profileId: string;
  attempts: DiscoveryBrowserLaunchAttempt[];
  close(): Promise<void>;
};

export type DiscoveryBrowserLaunchFailure = {
  ok: false;
  code: "invalid_browser_launch_profile" | "browser_profile_fallback_exhausted";
  message: string;
  attempts: DiscoveryBrowserLaunchAttempt[];
};

export type DiscoveryBrowserLaunchResult =
  DiscoveryBrowserLaunchHandle | DiscoveryBrowserLaunchFailure;

export type DiscoveryBrowserLauncherPage = {
  raw: Page;
  goto(url: string): Promise<void>;
  challengeSummary(): Promise<{ title: string; visibleText: string }>;
};

export type DiscoveryBrowserLauncherContext = {
  newPage(): Promise<DiscoveryBrowserLauncherPage>;
  close(): Promise<void>;
};

export type DiscoveryBrowserLauncherBrowser = {
  newContext(options: {
    viewport: { width: number; height: number };
  }): Promise<DiscoveryBrowserLauncherContext>;
  close(): Promise<void>;
};

export type DiscoveryBrowserLauncherDriver = {
  launch(profile: BrowserLaunchProfileV1): Promise<DiscoveryBrowserLauncherBrowser>;
};

export type DiscoveryBrowserLauncher = {
  launch(input: { url: string; profilePlan: unknown }): Promise<DiscoveryBrowserLaunchResult>;
};

export function createPlaywrightDiscoveryBrowserLauncher(): DiscoveryBrowserLauncher {
  return createPlaywrightDiscoveryBrowserLauncherForDriver(createDefaultDriver());
}

export function createPlaywrightDiscoveryBrowserLauncherForDriver(
  driver: DiscoveryBrowserLauncherDriver,
): DiscoveryBrowserLauncher {
  return {
    async launch(input) {
      const validation = validateBrowserLaunchProfilePlan(input.profilePlan);
      if (!validation.ok) {
        return {
          ok: false,
          code: "invalid_browser_launch_profile",
          message: "Browser launch profile is invalid.",
          attempts: [],
        };
      }

      const attempts: DiscoveryBrowserLaunchAttempt[] = [];
      for (let index = 0; index < validation.profiles.length; index += 1) {
        const profile = validation.profiles[index]!;
        const ordinal = (index + 1) as 1 | 2 | 3;
        const profileId = browserLaunchProfileId(profile);
        let browser: DiscoveryBrowserLauncherBrowser | undefined;
        let context: DiscoveryBrowserLauncherContext | undefined;
        try {
          browser = await driver.launch(profile);
        } catch {
          attempts.push({ ordinal, profileId, outcome: "browser_launch_failed" });
          continue;
        }
        try {
          context = await browser.newContext({ viewport: profile.viewport });
          const page = await context.newPage();
          try {
            await page.goto(input.url);
          } catch {
            attempts.push({ ordinal, profileId, outcome: "browser_navigation_failed" });
            await closeResources(context, browser);
            continue;
          }
          const challenge = classifyBrowserChallenge(await page.challengeSummary());
          if (challenge !== undefined) {
            attempts.push({
              ordinal,
              profileId,
              outcome: "anti_bot_challenge",
              challenge,
            });
            await closeResources(context, browser);
            continue;
          }
          let closed = false;
          return {
            ok: true,
            page: page.raw,
            profile,
            profileId,
            attempts,
            async close() {
              if (closed) return;
              closed = true;
              await closeResources(context, browser);
            },
          };
        } catch {
          attempts.push({ ordinal, profileId, outcome: "browser_navigation_failed" });
          await closeResources(context, browser);
        }
      }

      return {
        ok: false,
        code: "browser_profile_fallback_exhausted",
        message: "Browser launch profile fallback was exhausted.",
        attempts,
      };
    },
  };
}

function createDefaultDriver(): DiscoveryBrowserLauncherDriver {
  return {
    async launch(profile) {
      const browser = await chromium.launch({
        headless: profile.headless,
        ...(profile.channel === "bundled" ? {} : { channel: profile.channel }),
      });
      return wrapBrowser(browser);
    },
  };
}

function wrapBrowser(browser: Browser): DiscoveryBrowserLauncherBrowser {
  return {
    async newContext(options) {
      return wrapContext(await browser.newContext(options));
    },
    async close() {
      await browser.close();
    },
  };
}

function wrapContext(context: BrowserContext): DiscoveryBrowserLauncherContext {
  return {
    async newPage() {
      const page = await context.newPage();
      return {
        raw: page,
        async goto(url) {
          await page.goto(url, { waitUntil: "domcontentloaded" });
        },
        async challengeSummary() {
          return {
            title: await page.title().catch(() => ""),
            visibleText: await page
              .locator("body")
              .innerText({ timeout: 1_000 })
              .then((text) => text.slice(0, 8192))
              .catch(() => ""),
          };
        },
      };
    },
    async close() {
      await context.close();
    },
  };
}

async function closeResources(
  context: DiscoveryBrowserLauncherContext | undefined,
  browser: DiscoveryBrowserLauncherBrowser | undefined,
): Promise<void> {
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
}
