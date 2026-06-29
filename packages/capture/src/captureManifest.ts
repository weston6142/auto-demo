import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, sep, win32 } from "node:path";
import type {
  BrowserCaptureSource,
  CaptureChildCommand,
  CaptureStopReason,
  CaptureViewport,
} from "./index.js";

export const CAPTURE_MANIFEST_SCHEMA_VERSION = 1;
export const CAPTURE_PACKAGE_VERSION = "0.0.0";
export const PLAYWRIGHT_TOOL_VERSION = "1.61.1";

export type CaptureManifestStatus = CaptureStopReason;

export type CaptureManifestAdapter = {
  kind: "browser";
  backend: "playwright";
};

export type CaptureManifestTools = {
  capturePackage: string;
  playwright: string;
};

export type CaptureManifestArtifacts = {
  media: string;
  events: string;
};

export type CaptureManifestChildCommand = {
  command?: string;
  argCount: number;
  argsRedacted?: true;
  exitCode: number | null;
};

export type CaptureManifestChildCommandInput = CaptureChildCommand & {
  exitCode: number | null;
};

export type CaptureManifestError = {
  code: string;
  message: string;
};

export type CaptureManifest = {
  schemaVersion: 1;
  status: CaptureManifestStatus;
  source: BrowserCaptureSource;
  adapter: CaptureManifestAdapter;
  tools: CaptureManifestTools;
  viewport: CaptureViewport;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  artifacts: CaptureManifestArtifacts;
  childCommand: CaptureManifestChildCommand | null;
  error: CaptureManifestError | null;
};

export type WriteCaptureManifestInput = {
  outputDir: string;
  status: CaptureManifestStatus;
  source: BrowserCaptureSource;
  adapter: CaptureManifestAdapter;
  tools?: CaptureManifestTools;
  viewport: CaptureViewport;
  timing: {
    startedAt: string;
    endedAt: string;
    durationMs: number;
  };
  artifacts: {
    media: string;
    events: string;
  };
  childCommand: CaptureManifestChildCommandInput | null;
  error: CaptureManifestError | null;
};

export type CaptureBundleValidationResult =
  | {
      ok: true;
      manifestPath: string;
      manifest: CaptureManifest;
    }
  | {
      ok: false;
      manifestPath: string;
      errors: string[];
    };

export async function writeCaptureManifest(
  input: WriteCaptureManifestInput,
): Promise<CaptureManifest> {
  const manifest: CaptureManifest = {
    schemaVersion: CAPTURE_MANIFEST_SCHEMA_VERSION,
    status: input.status,
    source: sanitizeManifestSource(input.source),
    adapter: input.adapter,
    tools: input.tools ?? {
      capturePackage: CAPTURE_PACKAGE_VERSION,
      playwright: PLAYWRIGHT_TOOL_VERSION,
    },
    viewport: input.viewport,
    startedAt: input.timing.startedAt,
    endedAt: input.timing.endedAt,
    durationMs: input.timing.durationMs,
    artifacts: {
      media: portableArtifactPath(input.outputDir, input.artifacts.media),
      events: portableArtifactPath(input.outputDir, input.artifacts.events),
    },
    childCommand: sanitizeManifestChildCommand(input.childCommand),
    error: input.error,
  };

  await writeFile(manifestPathFor(input.outputDir), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export async function readCaptureManifest(pathOrBundleDir: string): Promise<CaptureManifest> {
  const manifestPath = await resolveManifestPath(pathOrBundleDir);
  const content = await readFile(manifestPath, "utf8");
  return JSON.parse(content) as CaptureManifest;
}

export async function validateCaptureBundle(
  pathOrBundleDir: string,
): Promise<CaptureBundleValidationResult> {
  const manifestPath = await resolveManifestPath(pathOrBundleDir);
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    const message =
      error instanceof SyntaxError ? "Manifest JSON is not parseable." : "Manifest cannot be read.";
    return { ok: false, manifestPath, errors: [message] };
  }

  const errors = validateManifestShape(parsed);
  if (errors.length > 0) {
    return { ok: false, manifestPath, errors };
  }

  const manifest = parsed as CaptureManifest;
  const bundleDir = dirname(manifestPath);
  await validateArtifact(bundleDir, "media", manifest.artifacts.media, errors);
  await validateArtifact(bundleDir, "events", manifest.artifacts.events, errors);

  if (errors.length > 0) {
    return { ok: false, manifestPath, errors };
  }

  return { ok: true, manifestPath, manifest };
}

function portableArtifactPath(outputDir: string, artifactPath: string): string {
  const path = isAbsolute(artifactPath) ? relative(outputDir, artifactPath) : artifactPath;
  return path.split(sep).join("/");
}

function sanitizeManifestSource(source: BrowserCaptureSource): BrowserCaptureSource {
  return {
    ...source,
    url: stripUrlSecrets(source.url),
  };
}

function sanitizeManifestChildCommand(
  command: CaptureManifestChildCommandInput | null,
): CaptureManifestChildCommand | null {
  if (command === null) {
    return null;
  }

  return omitUndefined({
    command: command.command,
    argCount: command.args.length,
    argsRedacted: command.args.length > 0 ? (true as const) : undefined,
    exitCode: command.exitCode,
  });
}

async function resolveManifestPath(pathOrBundleDir: string): Promise<string> {
  if (basename(pathOrBundleDir) === "capture.manifest.json") {
    return pathOrBundleDir;
  }

  return join(pathOrBundleDir, "capture.manifest.json");
}

function manifestPathFor(outputDir: string): string {
  return join(outputDir, "capture.manifest.json");
}

function validateManifestShape(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return ["Manifest must be a JSON object."];
  }

  if (value.schemaVersion !== CAPTURE_MANIFEST_SCHEMA_VERSION) {
    errors.push("Manifest schemaVersion must be 1.");
  }

  if (!["completed", "failed", "interrupted"].includes(stringValue(value.status))) {
    errors.push("Manifest status must be completed, failed, or interrupted.");
  }

  if (
    !isRecord(value.source) ||
    value.source.kind !== "browser" ||
    !isNonEmptyString(value.source.url)
  ) {
    errors.push("Manifest source must include browser url.");
  }

  if (
    !isRecord(value.adapter) ||
    value.adapter.kind !== "browser" ||
    value.adapter.backend !== "playwright"
  ) {
    errors.push("Manifest adapter must be browser playwright.");
  }

  if (
    !isRecord(value.tools) ||
    !isNonEmptyString(value.tools.capturePackage) ||
    !isNonEmptyString(value.tools.playwright)
  ) {
    errors.push("Manifest tools must include capturePackage and playwright versions.");
  }

  if (
    !isRecord(value.viewport) ||
    !isPositiveNumber(value.viewport.width) ||
    !isPositiveNumber(value.viewport.height)
  ) {
    errors.push("Manifest viewport must include positive width and height.");
  }

  if (!isIsoDateString(value.startedAt)) {
    errors.push("Manifest startedAt must be an ISO timestamp.");
  }

  if (!isIsoDateString(value.endedAt)) {
    errors.push("Manifest endedAt must be an ISO timestamp.");
  }

  if (typeof value.durationMs !== "number" || value.durationMs < 0) {
    errors.push("Manifest durationMs must be a nonnegative number.");
  }

  if (
    !isRecord(value.artifacts) ||
    !isPortablePath(value.artifacts.media) ||
    !isPortablePath(value.artifacts.events)
  ) {
    errors.push("Manifest artifacts must include relative media and events paths.");
  }

  if (
    value.childCommand !== null &&
    value.childCommand !== undefined &&
    !isRecord(value.childCommand)
  ) {
    errors.push("Manifest childCommand must be null or an object.");
  } else if (isRecord(value.childCommand) && !isValidChildCommand(value.childCommand)) {
    errors.push("Manifest childCommand must include argCount and exitCode when present.");
  }

  if (value.error !== null && value.error !== undefined && !isRecord(value.error)) {
    errors.push("Manifest error must be null or an object.");
  } else if (isRecord(value.error) && !isValidManifestError(value.error)) {
    errors.push("Manifest error must include code and message when present.");
  }

  return errors;
}

async function validateArtifact(
  bundleDir: string,
  label: "media" | "events",
  artifactPath: string,
  errors: string[],
): Promise<void> {
  try {
    const artifact = await stat(join(bundleDir, artifactPath));
    if (!artifact.isFile()) {
      errors.push(`Invalid ${label} artifact: ${artifactPath} must reference a file.`);
    }
  } catch {
    errors.push(`Missing ${label} artifact: ${artifactPath}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isValidChildCommand(value: Record<string, unknown>): boolean {
  const hasValidCommand = value.command === undefined || isNonEmptyString(value.command);
  const hasValidArgsRedacted = value.argsRedacted === undefined || value.argsRedacted === true;
  const hasValidExitCode =
    value.exitCode === null ||
    (typeof value.exitCode === "number" && Number.isInteger(value.exitCode));

  return (
    hasValidCommand &&
    isNonnegativeInteger(value.argCount) &&
    hasValidArgsRedacted &&
    hasValidExitCode
  );
}

function isValidManifestError(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.code) && isNonEmptyString(value.message);
}

function isPortablePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    isAbsolute(value) ||
    win32.isAbsolute(value)
  ) {
    return false;
  }

  return !value.split(/[\\/]/).includes("..");
}

function stripUrlSecrets(value: string): string {
  try {
    const url = new URL(value);
    if (url.origin === "null") {
      return `${url.protocol}[opaque]`;
    }
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Exclude<unknown, undefined>] => entry[1] !== undefined,
    ),
  ) as T;
}
