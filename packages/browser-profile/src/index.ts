import { createHash } from "node:crypto";

export const BROWSER_LAUNCH_PROFILE_SCHEMA_VERSION = 1 as const;
export const MAX_BROWSER_LAUNCH_ATTEMPTS = 3 as const;

export type BrowserLaunchProfileV1 = {
  schemaVersion: 1;
  browser: "chromium";
  channel: "bundled" | "chrome" | "msedge";
  headless: boolean;
  viewport: { width: number; height: number };
};

export type BrowserLaunchProfilePlanV1 = {
  schemaVersion: 1;
  primary: BrowserLaunchProfileV1;
  fallbacks?: BrowserLaunchProfileV1[];
};

export type BrowserLaunchProfileError = {
  code: "invalid_browser_launch_profile";
  message: "Browser launch profile is invalid.";
};

export type BrowserChallenge = {
  provider: "cloudflare" | "generic";
};

export const DEFAULT_BROWSER_LAUNCH_PROFILE: BrowserLaunchProfileV1 = {
  schemaVersion: BROWSER_LAUNCH_PROFILE_SCHEMA_VERSION,
  browser: "chromium",
  channel: "bundled",
  headless: true,
  viewport: { width: 1280, height: 720 },
};

const INVALID_PROFILE: BrowserLaunchProfileError = {
  code: "invalid_browser_launch_profile",
  message: "Browser launch profile is invalid.",
};

export function validateBrowserLaunchProfile(
  value: unknown,
):
  | { ok: true; profile: BrowserLaunchProfileV1; profileId: string }
  | { ok: false; errors: BrowserLaunchProfileError[] } {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "browser", "channel", "headless", "viewport"]) ||
    value.schemaVersion !== BROWSER_LAUNCH_PROFILE_SCHEMA_VERSION ||
    value.browser !== "chromium" ||
    (value.channel !== "bundled" && value.channel !== "chrome" && value.channel !== "msedge") ||
    typeof value.headless !== "boolean" ||
    !isRecord(value.viewport) ||
    !hasExactKeys(value.viewport, ["width", "height"]) ||
    !boundedInteger(value.viewport.width, 1, 4096) ||
    !boundedInteger(value.viewport.height, 1, 4096)
  ) {
    return { ok: false, errors: [{ ...INVALID_PROFILE }] };
  }

  const profile: BrowserLaunchProfileV1 = {
    schemaVersion: BROWSER_LAUNCH_PROFILE_SCHEMA_VERSION,
    browser: "chromium",
    channel: value.channel,
    headless: value.headless,
    viewport: {
      width: value.viewport.width,
      height: value.viewport.height,
    },
  };
  return { ok: true, profile, profileId: browserLaunchProfileId(profile) };
}

export function validateBrowserLaunchProfilePlan(value: unknown):
  | {
      ok: true;
      plan: BrowserLaunchProfilePlanV1;
      profiles: BrowserLaunchProfileV1[];
    }
  | { ok: false; errors: BrowserLaunchProfileError[] } {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schemaVersion", "primary", "fallbacks"], ["fallbacks"]) ||
    value.schemaVersion !== BROWSER_LAUNCH_PROFILE_SCHEMA_VERSION ||
    (value.fallbacks !== undefined && !Array.isArray(value.fallbacks))
  ) {
    return { ok: false, errors: [{ ...INVALID_PROFILE }] };
  }

  const candidates = [value.primary, ...((value.fallbacks as unknown[] | undefined) ?? [])];
  if (candidates.length > MAX_BROWSER_LAUNCH_ATTEMPTS) {
    return { ok: false, errors: [{ ...INVALID_PROFILE }] };
  }
  const profiles: BrowserLaunchProfileV1[] = [];
  const ids = new Set<string>();
  for (const candidate of candidates) {
    const validation = validateBrowserLaunchProfile(candidate);
    if (!validation.ok || ids.has(validation.profileId)) {
      return { ok: false, errors: [{ ...INVALID_PROFILE }] };
    }
    profiles.push(validation.profile);
    ids.add(validation.profileId);
  }
  const [primary, ...fallbacks] = profiles;
  if (primary === undefined) return { ok: false, errors: [{ ...INVALID_PROFILE }] };
  return {
    ok: true,
    plan: {
      schemaVersion: BROWSER_LAUNCH_PROFILE_SCHEMA_VERSION,
      primary,
      ...(fallbacks.length === 0 ? {} : { fallbacks }),
    },
    profiles,
  };
}

export function browserLaunchProfileId(profile: BrowserLaunchProfileV1): string {
  const publicProjection = {
    browser: profile.browser,
    channel: profile.channel,
    headless: profile.headless,
    schemaVersion: profile.schemaVersion,
    viewport: {
      height: profile.viewport.height,
      width: profile.viewport.width,
    },
  };
  const digest = createHash("sha256").update(JSON.stringify(publicProjection)).digest("hex");
  return `sha256:${digest}`;
}

export function classifyBrowserChallenge(summary: {
  title: string;
  visibleText: string;
}): BrowserChallenge | undefined {
  const title = summary.title.slice(0, 8192).toLowerCase();
  const text = summary.visibleText.slice(0, 8192).toLowerCase();
  const cloudflareTitle = title.includes("just a moment") || title.includes("attention required");
  const cloudflareBody =
    text.includes("security verification") ||
    text.includes("security service to protect") ||
    text.includes("cloudflare ray id");
  if (cloudflareTitle && cloudflareBody) return { provider: "cloudflare" };

  const verificationTitle =
    title.includes("verify you are human") || title.includes("human verification");
  const verificationBody =
    text.includes("complete the verification") ||
    text.includes("confirm you are human") ||
    text.includes("verify you are human");
  return verificationTitle && verificationBody ? { provider: "generic" } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowed.includes(key)) &&
    allowed.every((key) => optional.includes(key) || Object.hasOwn(value, key))
  );
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum
  );
}
