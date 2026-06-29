# WES-143 Browser Capture Adapter CLI Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first browser capture adapter skeleton and `autodemo capture` CLI contract without real Playwright recording.

**Architecture:** `packages/capture` owns capture option/result/session types and a browser adapter factory that currently fails clearly. `packages/cli` parses the `capture` command, validates `--url`, `--out`, optional `--viewport`, optional child command after `--`, and calls an injectable capture adapter so CLI behavior can be tested without a real browser backend.

**Tech Stack:** TypeScript, npm workspaces, Vitest, Node ESM, existing package boundaries.

---

## File Structure

- Modify `packages/capture/src/index.ts`: replace the foundation capture contract with WES-144-aligned browser capture types, viewport parsing data shapes, result codes, and unsupported browser adapter behavior.
- Modify `packages/capture/src/index.test.ts`: verify the browser adapter skeleton accepts the new options and fails with the correct public result shape.
- Modify `packages/cli/src/index.ts`: keep synchronous help behavior, add `capture` parsing, validation, dependency injection, and async capture execution.
- Modify `packages/cli/src/index.test.ts`: add behavior tests for capture argument validation, viewport parsing, child command parsing, adapter invocation, and default unsupported-adapter failure.
- Modify `packages/cli/package.json`: add the `@auto-demo/capture` workspace dependency.
- Modify `package.json`: run workspace builds before root typecheck so cross-package imports resolve from `dist` in clean checkouts.
- No new runtime dependencies are needed for WES-143.

## Task 1: Capture Package Contract

**Files:**

- Modify: `packages/capture/src/index.ts`
- Test: `packages/capture/src/index.test.ts`

- [ ] **Step 1: Write the failing capture contract tests**

Replace `packages/capture/src/index.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { createUnsupportedBrowserCaptureAdapter } from "./index.js";

describe("createUnsupportedBrowserCaptureAdapter", () => {
  it("fails clearly while preserving the requested output paths", async () => {
    const adapter = createUnsupportedBrowserCaptureAdapter();

    const result = await adapter.start({
      source: { kind: "browser", url: "https://example.com" },
      outputDir: "demo-capture",
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-28T12:00:00.000Z",
      childCommand: {
        command: "npm",
        args: ["run", "demo:walkthrough"],
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "capture_not_implemented",
      message: "Browser capture is not implemented yet.",
      outputDir: "demo-capture",
      manifestPath: "demo-capture/capture.manifest.json",
    });
  });
});
```

- [ ] **Step 2: Run the capture package test to verify it fails**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: FAIL because `createUnsupportedBrowserCaptureAdapter` is not exported.

- [ ] **Step 3: Implement the capture contract**

Replace `packages/capture/src/index.ts` with:

```ts
export const CAPTURE_MANIFEST_FILENAME = "capture.manifest.json";
export const DEFAULT_BROWSER_VIEWPORT = {
  width: 1280,
  height: 720,
} as const;

export type BrowserCaptureSource = {
  kind: "browser";
  url: string;
};

export type CaptureSource = BrowserCaptureSource;

export type CaptureViewport = {
  width: number;
  height: number;
};

export type CaptureChildCommand = {
  command: string;
  args: string[];
};

export type BrowserCaptureOptions = {
  source: BrowserCaptureSource;
  outputDir: string;
  viewport: CaptureViewport;
  startedAt: string;
  childCommand?: CaptureChildCommand;
};

export type CaptureStopReason = "completed" | "failed" | "interrupted";

export type CaptureOutput = {
  outputDir: string;
  manifestPath: string;
};

export type CaptureErrorCode = "capture_not_implemented";

export type CaptureStartResult =
  | {
      ok: true;
      session: CaptureSession;
      outputDir: string;
      manifestPath: string;
    }
  | {
      ok: false;
      code: CaptureErrorCode;
      message: string;
      outputDir: string;
      manifestPath: string;
    };

export type CaptureStopResult =
  | {
      ok: true;
      output: CaptureOutput;
    }
  | {
      ok: false;
      code: CaptureErrorCode;
      message: string;
      outputDir: string;
      manifestPath: string;
    };

export type CaptureSession = {
  readonly outputDir: string;
  readonly manifestPath: string;
  stop(reason: CaptureStopReason): Promise<CaptureStopResult>;
};

export type BrowserCaptureAdapter = {
  readonly kind: "browser";
  start(options: BrowserCaptureOptions): Promise<CaptureStartResult>;
};

export function createUnsupportedBrowserCaptureAdapter(): BrowserCaptureAdapter {
  return {
    kind: "browser",
    async start(options) {
      return {
        ok: false,
        code: "capture_not_implemented",
        message: "Browser capture is not implemented yet.",
        outputDir: options.outputDir,
        manifestPath: manifestPathForOutputDir(options.outputDir),
      };
    },
  };
}

export function manifestPathForOutputDir(outputDir: string): string {
  return `${trimTrailingSlashes(outputDir)}/${CAPTURE_MANIFEST_FILENAME}`;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, "");
}
```

- [ ] **Step 4: Run the capture package test to verify it passes**

Run:

```bash
rtk npm --workspace @auto-demo/capture test
```

Expected: PASS.

- [ ] **Step 5: Commit the capture contract**

Run:

```bash
rtk npm --workspace @auto-demo/capture run build
```

Expected: PASS and `packages/capture/dist/index.d.ts` exists for CLI type resolution.

- [ ] **Step 6: Commit the capture contract**

Run:

```bash
git add packages/capture/src/index.ts packages/capture/src/index.test.ts
git commit -m "feat: define browser capture adapter contract"
```

## Task 2: CLI Capture Argument Parsing

**Files:**

- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/package.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing CLI parsing and validation tests**

Replace `packages/cli/src/index.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { runCli, runCliAsync } from "./index.js";

describe("runCli", () => {
  it("prints help with a zero exit code", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: autodemo <command>");
    expect(result.stderr).toBe("");
  });

  it("fails clearly for planned but unimplemented non-capture commands", () => {
    const result = runCli(["generate"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo generate is not implemented yet.\n",
    });
  });

  it("prints help and fails for unknown commands", () => {
    const result = runCli(["wat"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Usage: autodemo <command>");
    expect(result.stderr).toBe("Unknown command: wat\n");
  });
});

describe("runCliAsync capture", () => {
  it("requires --url", async () => {
    const result = await runCliAsync(["capture", "--out", "demo-capture"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo capture requires --url <url>.\n",
    });
  });

  it("requires --out", async () => {
    const result = await runCliAsync(["capture", "--url", "https://example.com"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo capture requires --out <capture-dir>.\n",
    });
  });

  it("rejects invalid viewport values", async () => {
    const result = await runCliAsync([
      "capture",
      "--url",
      "https://example.com",
      "--out",
      "demo-capture",
      "--viewport",
      "wide",
    ]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo capture --viewport must use <width>x<height>, for example 1280x720.\n",
    });
  });
});
```

- [ ] **Step 2: Run the CLI tests to verify they fail**

Run:

```bash
rtk npm --workspace @auto-demo/cli test
```

Expected: FAIL because `runCliAsync` is not exported and `capture` still uses the old unimplemented-command branch.

- [ ] **Step 3: Add capture parsing and validation**

Replace `packages/cli/src/index.ts` with:

```ts
#!/usr/bin/env node

import {
  createUnsupportedBrowserCaptureAdapter,
  DEFAULT_BROWSER_VIEWPORT,
  type BrowserCaptureAdapter,
  type BrowserCaptureOptions,
  type CaptureChildCommand,
  type CaptureViewport,
} from "@auto-demo/capture";

export type CliResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CliDependencies = {
  browserCaptureAdapter: BrowserCaptureAdapter;
  now: () => Date;
};

type ParsedCaptureCommand =
  | {
      ok: true;
      options: BrowserCaptureOptions;
    }
  | {
      ok: false;
      message: string;
    };

const plannedCommands = new Set(["init", "capture", "generate", "export", "open", "validate"]);

export function runCli(args: string[]): CliResult {
  const [command] = args;

  if (command === undefined || command === "--help" || command === "-h") {
    return {
      exitCode: 0,
      stdout: helpText(),
      stderr: "",
    };
  }

  if (command === "capture") {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo capture requires async execution.\n",
    };
  }

  if (plannedCommands.has(command)) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `autodemo ${command} is not implemented yet.\n`,
    };
  }

  return {
    exitCode: 1,
    stdout: helpText(),
    stderr: `Unknown command: ${command}\n`,
  };
}

export async function runCliAsync(
  args: string[],
  dependencies: CliDependencies = defaultDependencies(),
): Promise<CliResult> {
  const [command, ...rest] = args;

  if (command !== "capture") {
    return runCli(args);
  }

  const parsed = parseCaptureCommand(rest, dependencies.now);
  if (!parsed.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${parsed.message}\n`,
    };
  }

  const result = await dependencies.browserCaptureAdapter.start(parsed.options);
  if (!result.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${result.message}\n`,
    };
  }

  return {
    exitCode: 0,
    stdout: `Capture bundle: ${result.manifestPath}\n`,
    stderr: "",
  };
}

function parseCaptureCommand(args: string[], now: () => Date): ParsedCaptureCommand {
  let url: string | undefined;
  let outputDir: string | undefined;
  let viewport: CaptureViewport = { ...DEFAULT_BROWSER_VIEWPORT };
  let childCommand: CaptureChildCommand | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      const childParts = args.slice(index + 1);
      if (childParts.length > 0) {
        const [command, ...commandArgs] = childParts;
        childCommand = { command, args: commandArgs };
      }
      break;
    }

    if (arg === "--url") {
      url = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--out") {
      outputDir = args[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--viewport") {
      const parsedViewport = parseViewport(args[index + 1]);
      if (parsedViewport === undefined) {
        return {
          ok: false,
          message: "autodemo capture --viewport must use <width>x<height>, for example 1280x720.",
        };
      }
      viewport = parsedViewport;
      index += 1;
      continue;
    }

    return {
      ok: false,
      message: `Unknown autodemo capture option: ${arg}`,
    };
  }

  if (url === undefined || url.trim().length === 0) {
    return { ok: false, message: "autodemo capture requires --url <url>." };
  }

  if (outputDir === undefined || outputDir.trim().length === 0) {
    return { ok: false, message: "autodemo capture requires --out <capture-dir>." };
  }

  return {
    ok: true,
    options: {
      source: { kind: "browser", url },
      outputDir,
      viewport,
      startedAt: now().toISOString(),
      childCommand,
    },
  };
}

function parseViewport(input: string | undefined): CaptureViewport | undefined {
  if (input === undefined) {
    return undefined;
  }

  const match = /^(?<width>[1-9]\d*)x(?<height>[1-9]\d*)$/.exec(input);
  if (match?.groups === undefined) {
    return undefined;
  }

  return {
    width: Number.parseInt(match.groups.width, 10),
    height: Number.parseInt(match.groups.height, 10),
  };
}

function defaultDependencies(): CliDependencies {
  return {
    browserCaptureAdapter: createUnsupportedBrowserCaptureAdapter(),
    now: () => new Date(),
  };
}

function helpText(): string {
  return [
    "Usage: autodemo <command>",
    "",
    "Commands:",
    "  init       Prepare an Auto Demo project context",
    "  capture    Record a browser-first walkthrough",
    "  generate   Generate polished variants",
    "  export     Render selected variants",
    "  open       Open the local editor",
    "  validate   Validate a capture bundle",
    "",
  ].join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runCliAsync(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
```

- [ ] **Step 4: Add the CLI dependency on capture**

Modify `packages/cli/package.json` so it includes the workspace dependency:

```json
{
  "name": "@auto-demo/cli",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": {
    "autodemo": "dist/index.js"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run src/index.test.ts"
  },
  "dependencies": {
    "@auto-demo/capture": "0.0.0"
  }
}
```

- [ ] **Step 5: Update the root validation order for workspace imports**

Modify the root `package.json` scripts block to run build before typecheck:

```json
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "lint": "eslint .",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "validate": "npm run build && npm run typecheck && npm run lint && npm test && npm run format:check"
  },
```

- [ ] **Step 6: Refresh the package lock**

Run:

```bash
rtk npm install --package-lock-only
```

Expected: PASS and `package-lock.json` records `@auto-demo/cli` depending on `@auto-demo/capture`.

- [ ] **Step 7: Build capture before focused CLI tests**

Run:

```bash
rtk npm --workspace @auto-demo/capture run build
```

Expected: PASS.

- [ ] **Step 8: Run the CLI tests to verify they pass**

Run:

```bash
rtk npm --workspace @auto-demo/cli test
```

Expected: PASS.

- [ ] **Step 9: Commit CLI parsing**

Run:

```bash
git add package.json packages/cli/src/index.ts packages/cli/src/index.test.ts packages/cli/package.json package-lock.json
git commit -m "feat: parse browser capture CLI options"
```

## Task 3: CLI Adapter Invocation Contract

**Files:**

- Modify: `packages/cli/src/index.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Add failing adapter invocation tests**

Append these tests to the `describe("runCliAsync capture", ...)` block in `packages/cli/src/index.test.ts`:

```ts
it("passes capture options to the browser adapter", async () => {
  const starts: unknown[] = [];

  const result = await runCliAsync(
    [
      "capture",
      "--url",
      "https://example.com",
      "--out",
      "demo-capture",
      "--viewport",
      "1440x900",
      "--",
      "npm",
      "run",
      "demo:walkthrough",
    ],
    {
      now: () => new Date("2026-06-28T12:00:00.000Z"),
      browserCaptureAdapter: {
        kind: "browser",
        async start(options) {
          starts.push(options);
          return {
            ok: true,
            outputDir: options.outputDir,
            manifestPath: `${options.outputDir}/capture.manifest.json`,
            session: {
              outputDir: options.outputDir,
              manifestPath: `${options.outputDir}/capture.manifest.json`,
              async stop() {
                return {
                  ok: true,
                  output: {
                    outputDir: options.outputDir,
                    manifestPath: `${options.outputDir}/capture.manifest.json`,
                  },
                };
              },
            },
          };
        },
      },
    },
  );

  expect(result).toEqual({
    exitCode: 0,
    stdout: "Capture bundle: demo-capture/capture.manifest.json\n",
    stderr: "",
  });
  expect(starts).toEqual([
    {
      source: { kind: "browser", url: "https://example.com" },
      outputDir: "demo-capture",
      viewport: { width: 1440, height: 900 },
      startedAt: "2026-06-28T12:00:00.000Z",
      childCommand: {
        command: "npm",
        args: ["run", "demo:walkthrough"],
      },
    },
  ]);
});

it("uses the default viewport and no child command when omitted", async () => {
  const starts: unknown[] = [];

  const result = await runCliAsync(
    ["capture", "--url", "https://example.com", "--out", "demo-capture"],
    {
      now: () => new Date("2026-06-28T12:00:00.000Z"),
      browserCaptureAdapter: {
        kind: "browser",
        async start(options) {
          starts.push(options);
          return {
            ok: false,
            code: "capture_not_implemented",
            message: "Browser capture is not implemented yet.",
            outputDir: options.outputDir,
            manifestPath: `${options.outputDir}/capture.manifest.json`,
          };
        },
      },
    },
  );

  expect(result).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "Browser capture is not implemented yet.\n",
  });
  expect(starts).toEqual([
    {
      source: { kind: "browser", url: "https://example.com" },
      outputDir: "demo-capture",
      viewport: { width: 1280, height: 720 },
      startedAt: "2026-06-28T12:00:00.000Z",
    },
  ]);
});
```

- [ ] **Step 2: Run the CLI tests**

Run:

```bash
rtk npm --workspace @auto-demo/cli test
```

Expected: PASS if Task 2 already implemented the adapter invocation correctly. If the tests fail, the failure should point to option shape or result mapping.

- [ ] **Step 3: Fix option shape or result mapping if needed**

If the tests fail because `childCommand` is present as `undefined`, update the return block in `parseCaptureCommand` in `packages/cli/src/index.ts` to build options without that property when no child command exists:

```ts
const options: BrowserCaptureOptions = {
  source: { kind: "browser", url },
  outputDir,
  viewport,
  startedAt: now().toISOString(),
};

if (childCommand !== undefined) {
  options.childCommand = childCommand;
}

return {
  ok: true,
  options,
};
```

- [ ] **Step 4: Run the CLI tests again**

Run:

```bash
rtk npm --workspace @auto-demo/cli test
```

Expected: PASS.

- [ ] **Step 5: Commit adapter invocation tests**

Run:

```bash
git add packages/cli/src/index.ts packages/cli/src/index.test.ts
git commit -m "test: cover capture adapter invocation"
```

## Task 4: Workspace Validation And Documentation Link

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Add WES-143 plan link to the project map**

Modify the Local Context section in `docs/linear/auto-demo-project-structure.md` so it includes:

```markdown
- WES-143 implementation plan: `docs/superpowers/plans/2026-06-28-wes-143-browser-capture-adapter-cli-contract-plan.md`
```

- [ ] **Step 2: Run typecheck**

Run:

```bash
rtk npm run typecheck
```

Expected: PASS.

- [ ] **Step 3: Run lint**

Run:

```bash
rtk npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run tests**

Run:

```bash
rtk npm test
```

Expected: PASS.

- [ ] **Step 5: Run full validation**

Run:

```bash
rtk npm run validate
```

Expected: PASS.

- [ ] **Step 6: Commit validation docs**

Run:

```bash
git add docs/linear/auto-demo-project-structure.md
git commit -m "docs: link browser capture CLI plan"
```

## Task 5: Linear Completion Evidence

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Add local completion evidence**

Append this bullet under `## Completion Evidence` in `docs/linear/auto-demo-project-structure.md` after the WES-141 evidence:

```markdown
- WES-143: Browser capture adapter skeleton and CLI contract implemented with capture package contracts, `autodemo capture` argument validation, injected browser adapter invocation, default unsupported backend failure, and behavior-oriented tests.
```

- [ ] **Step 2: Run a focused verification command**

Run:

```bash
rtk npm run validate
```

Expected: PASS.

- [ ] **Step 3: Commit completion evidence**

Run:

```bash
git add docs/linear/auto-demo-project-structure.md
git commit -m "docs: record WES-143 completion evidence"
```

- [ ] **Step 4: Add a Linear evidence comment**

Run:

```bash
linear issue comment add WES-143 -b "Implemented browser capture adapter skeleton and CLI contract. Evidence: capture package exposes WES-144-aligned browser capture types and unsupported adapter; CLI parses autodemo capture --url/--out/--viewport and child command after --; tests cover validation and adapter invocation; npm run validate passes."
```

Expected: Linear adds a comment to WES-143.

- [ ] **Step 5: Move WES-143 to Done**

Run:

```bash
linear issue update WES-143 --state Done
```

Expected: WES-143 moves to Done.

## Self-Review Notes

- Spec coverage: WES-144's first implementation issue is WES-143. This plan covers the CLI-owned capture command shape, adapter boundary, default viewport, child command parsing, default unsupported backend behavior, and behavior-oriented tests. Real Playwright media, metadata JSONL, bundle manifest writing, and partial-artifact preservation are assigned to WES-142, WES-145, WES-147, and WES-146.
- Red-flag scan: the plan avoids deferred work markers and includes concrete code, commands, and expected outcomes for each implementation step.
- Type consistency: `BrowserCaptureOptions`, `BrowserCaptureAdapter`, `CaptureStartResult`, `CaptureSession`, and `CaptureStopResult` are defined in Task 1 before CLI code imports them in Task 2.
