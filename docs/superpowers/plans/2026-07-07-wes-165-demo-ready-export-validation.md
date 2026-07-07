# WES-165 Demo-Ready Export Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable demo-ready export validation path for the canonical saved-variant fixture.

**Architecture:** Keep product code unchanged. Add a repo-owned fixture, a root validation script that runs the existing built CLI against a temporary fixture copy, and behavior-oriented docs/fixture tests that keep the public validation path from drifting.

**Tech Stack:** Node.js ESM scripts, npm workspaces, Vitest, Auto Demo project/render packages, ffmpeg/ffprobe for the explicit smoke validation command.

---

### Task 1: Fixture And Documentation Tests

**Files:**

- Modify: `packages/render/src/render-docs.test.ts`

- [ ] **Step 1: Write failing fixture/docs behavior tests**

Extend `packages/render/src/render-docs.test.ts` with imports for `readdir` and `stat` from `node:fs/promises`, and import `loadProject` from `@auto-demo/project`.

Add helpers:

```ts
async function readFixtureProject() {
  return await loadProject(join(repoRoot, "fixtures", "export", "basic-saved-variant"));
}
```

Add tests:

```ts
it("ships the canonical demo-ready saved-variant fixture", async () => {
  const loaded = await readFixtureProject();
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) {
    throw new Error(loaded.errors.map((error) => error.message).join("\n"));
  }

  expect(loaded.manifest.name).toBe("Checkout flow demo");
  expect(loaded.manifest.sourceCapture.source).toEqual({
    kind: "browser",
    url: "https://example.com/checkout",
  });
  expect(loaded.manifest.media.primary.path).toBe("raw/capture.webm");
  expect(loaded.manifest.metadata.events.path).toBe("metadata/events.jsonl");

  const variant = loaded.manifest.variants.find((candidate) => candidate.id === "baseline-polish");
  expect(variant).toBeDefined();
  expect(variant?.displayName).toBe("Baseline Polish");
  expect(variant?.source).toEqual({
    mediaPath: "raw/capture.webm",
    eventsPath: "metadata/events.jsonl",
  });
  expect(variant?.exportIntent).toEqual({
    format: "mp4",
    quality: "demo",
    aspectRatio: "16:9",
  });

  const media = await stat(join(loaded.projectDir, "raw", "capture.webm"));
  expect(media.size).toBeGreaterThan(0);
  expect(await readdir(join(loaded.projectDir, "exports"))).toEqual([".gitkeep"]);
});

it("documents the repeatable demo-ready export validation command", async () => {
  const renderReadme = normalizeWhitespace(await readRenderDoc("README.md"));
  const rootReadme = normalizeWhitespace(await readRootDoc("README.md"));
  const combined = `${renderReadme} ${rootReadme}`;

  for (const required of [
    "npm run validate:demo-ready",
    "npm install",
    "npm run build",
    "npm run setup:browser",
    "ffmpeg",
    "ffprobe",
    "copies fixtures/export/basic-saved-variant",
    "exports/baseline-polish.mp4",
    "exports/baseline-polish.render.json",
    "synthetic fixture",
    "mp4-only",
    "no audio track",
    "no rendered captions",
    "local-only checkout",
  ]) {
    expect(combined).toContain(required);
  }
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `rtk npm --workspace @auto-demo/render test -- src/render-docs.test.ts`

Expected: FAIL because `fixtures/export/basic-saved-variant` and `npm run validate:demo-ready` docs do not exist.

### Task 2: Canonical Fixture And Validation Script

**Files:**

- Create: `fixtures/export/basic-saved-variant/autodemo.project.json`
- Create: `fixtures/export/basic-saved-variant/raw/capture.webm`
- Create: `fixtures/export/basic-saved-variant/metadata/events.jsonl`
- Create: `fixtures/export/basic-saved-variant/metadata/capture.manifest.json`
- Create: `fixtures/export/basic-saved-variant/variants/baseline-polish.json`
- Create: `fixtures/export/basic-saved-variant/exports/.gitkeep`
- Create: `scripts/validate-demo-ready-export.mjs`
- Modify: `package.json`

- [ ] **Step 1: Generate a tiny synthetic WebM fixture**

Run:

```bash
mkdir -p fixtures/export/basic-saved-variant/raw fixtures/export/basic-saved-variant/metadata fixtures/export/basic-saved-variant/variants fixtures/export/basic-saved-variant/exports
ffmpeg -y -f lavfi -i color=c=0x0f172a:s=1280x720:d=6:r=30 -vf "drawbox=x=440:y=260:w=400:h=160:color=0x38bdf8@0.9:t=fill,drawbox=x=500:y=320:w=280:h=40:color=0xffffff@0.9:t=fill" -an -c:v libvpx-vp9 -pix_fmt yuv420p fixtures/export/basic-saved-variant/raw/capture.webm
touch fixtures/export/basic-saved-variant/exports/.gitkeep
```

Expected: `fixtures/export/basic-saved-variant/raw/capture.webm` exists and is non-empty.

- [ ] **Step 2: Add fixture JSON files**

Create `fixtures/export/basic-saved-variant/variants/baseline-polish.json`:

```json
{
  "id": "baseline-polish",
  "displayName": "Baseline Polish",
  "source": {
    "mediaPath": "raw/capture.webm",
    "eventsPath": "metadata/events.jsonl"
  },
  "timeline": {
    "startMs": 0,
    "endMs": 6000
  },
  "viewport": {
    "mode": "contain",
    "focus": {
      "x": 0.5,
      "y": 0.5
    },
    "zoom": 1
  },
  "cursor": {
    "visible": true,
    "emphasis": "spotlight"
  },
  "clicks": {
    "emphasis": "ring"
  },
  "captions": [],
  "callouts": [],
  "style": {
    "background": "solid",
    "backgroundColor": "#0f172a",
    "frame": "browser",
    "padding": 48,
    "cornerRadius": 16
  },
  "exportIntent": {
    "format": "mp4",
    "quality": "demo",
    "aspectRatio": "16:9"
  }
}
```

Create `fixtures/export/basic-saved-variant/metadata/events.jsonl`:

```jsonl
{"id":"event-1","sequence":1,"type":"navigation","timestampMs":0,"viewport":{"width":1280,"height":720},"data":{"url":"https://example.com/checkout"}}
{"id":"event-2","sequence":2,"type":"click","timestampMs":1200,"viewport":{"width":1280,"height":720},"data":{"x":640,"y":360}}
```

Create `fixtures/export/basic-saved-variant/metadata/capture.manifest.json`:

```json
{
  "schemaVersion": 1,
  "status": "completed",
  "source": {
    "kind": "browser",
    "url": "https://example.com/checkout"
  },
  "viewport": {
    "width": 1280,
    "height": 720
  },
  "timing": {
    "startedAt": "2026-07-07T00:00:00.000Z",
    "endedAt": "2026-07-07T00:00:06.000Z",
    "durationMs": 6000
  },
  "adapter": {
    "kind": "browser",
    "backend": "playwright"
  },
  "tools": {
    "capturePackage": "0.0.0",
    "playwright": "1.61.1"
  },
  "artifacts": {
    "media": "raw/capture.webm",
    "events": "metadata/events.jsonl"
  },
  "childCommand": null,
  "error": null
}
```

Create `fixtures/export/basic-saved-variant/autodemo.project.json` using the same variant object embedded in the `variants` array:

```json
{
  "schemaVersion": 1,
  "name": "Checkout flow demo",
  "createdAt": "2026-07-07T00:00:00.000Z",
  "updatedAt": "2026-07-07T00:00:00.000Z",
  "sourceCapture": {
    "kind": "browser",
    "status": "completed",
    "source": {
      "kind": "browser",
      "url": "https://example.com/checkout"
    },
    "viewport": {
      "width": 1280,
      "height": 720
    },
    "timing": {
      "startedAt": "2026-07-07T00:00:00.000Z",
      "endedAt": "2026-07-07T00:00:06.000Z",
      "durationMs": 6000
    },
    "adapter": {
      "kind": "browser",
      "backend": "playwright"
    },
    "tools": {
      "capturePackage": "0.0.0",
      "playwright": "1.61.1"
    },
    "manifestPath": "metadata/capture.manifest.json"
  },
  "media": {
    "primary": {
      "kind": "viewport",
      "path": "raw/capture.webm",
      "contentType": "video/webm"
    }
  },
  "metadata": {
    "events": {
      "path": "metadata/events.jsonl",
      "contentType": "application/x-ndjson"
    }
  },
  "variants": [
    {
      "id": "baseline-polish",
      "displayName": "Baseline Polish",
      "source": {
        "mediaPath": "raw/capture.webm",
        "eventsPath": "metadata/events.jsonl"
      },
      "timeline": {
        "startMs": 0,
        "endMs": 6000
      },
      "viewport": {
        "mode": "contain",
        "focus": {
          "x": 0.5,
          "y": 0.5
        },
        "zoom": 1
      },
      "cursor": {
        "visible": true,
        "emphasis": "spotlight"
      },
      "clicks": {
        "emphasis": "ring"
      },
      "captions": [],
      "callouts": [],
      "style": {
        "background": "solid",
        "backgroundColor": "#0f172a",
        "frame": "browser",
        "padding": 48,
        "cornerRadius": 16
      },
      "exportIntent": {
        "format": "mp4",
        "quality": "demo",
        "aspectRatio": "16:9"
      }
    }
  ],
  "previews": [],
  "exports": []
}
```

- [ ] **Step 3: Add the validation script**

Create `scripts/validate-demo-ready-export.mjs`:

```js
import { spawnSync } from "node:child_process";
import { copyFile, cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const fixtureDir = join(repoRoot, "fixtures", "export", "basic-saved-variant");
const tempRoot = await mkdtemp(join(tmpdir(), "auto-demo-ready-export-"));
const projectCopy = join(tempRoot, "basic-saved-variant");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    ...options,
  });
  return result;
}

function requireCommand(command) {
  const result = run(command, ["-version"]);
  if (result.status !== 0) {
    console.error(`${command} is required on PATH for demo-ready export validation.`);
    process.exit(1);
  }
}

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

requireCommand("ffmpeg");
requireCommand("ffprobe");

await cp(fixtureDir, projectCopy, { recursive: true });
await copyFile(join(projectCopy, "exports", ".gitkeep"), join(projectCopy, "exports", ".gitkeep"));

const exportResult = run("npm", [
  "run",
  "autodemo",
  "--",
  "export",
  "--project",
  projectCopy,
  "--json",
]);

if (exportResult.status !== 0) {
  process.stdout.write(exportResult.stdout);
  process.stderr.write(exportResult.stderr);
  process.exit(exportResult.status ?? 1);
}

let parsed;
try {
  parsed = JSON.parse(exportResult.stdout);
} catch {
  console.error("autodemo export did not print valid JSON.");
  process.exit(1);
}

assert(parsed.ok === true, "autodemo export did not report ok: true.");
assert(parsed.variantId === "baseline-polish", "Expected baseline-polish variant export.");
assert(parsed.preset?.key === "mp4-demo", "Expected mp4-demo preset.");

const outputPath = join(projectCopy, "exports", "baseline-polish.mp4");
const summaryPath = join(projectCopy, "exports", "baseline-polish.render.json");
assert(parsed.outputPath === outputPath, "Export JSON reported an unexpected MP4 path.");
assert(
  parsed.summaryPath === summaryPath,
  "Export JSON reported an unexpected render summary path.",
);

const output = await stat(outputPath);
assert(output.isFile() && output.size > 0, "Expected non-empty MP4 artifact.");

const summary = JSON.parse(await readFile(summaryPath, "utf8"));
assert(summary.ok === true, "Render summary did not report ok: true.");
assert(summary.variantId === "baseline-polish", "Render summary variant mismatch.");
assert(summary.preset?.key === "mp4-demo", "Render summary preset mismatch.");
assert(
  summary.outputPath === "exports/baseline-polish.mp4",
  "Render summary should use a project-relative MP4 path.",
);

const probe = run("ffprobe", ["-v", "error", "-show_format", "-show_streams", outputPath]);
assert(probe.status === 0, "ffprobe could not inspect the generated MP4 artifact.");

console.log("Demo-ready export validation passed.");
console.log(`Project copy: ${projectCopy}`);
console.log(`MP4: ${relative(projectCopy, outputPath)}`);
console.log(`Render summary: ${relative(projectCopy, summaryPath)}`);
```

- [ ] **Step 4: Add the root script**

Modify `package.json` scripts:

```json
"validate:demo-ready": "node scripts/validate-demo-ready-export.mjs"
```

- [ ] **Step 5: Run focused tests and verify GREEN for fixture shape after docs are updated in Task 3**

Run after Task 3: `rtk npm --workspace @auto-demo/render test -- src/render-docs.test.ts`

Expected: PASS.

### Task 3: Operator Documentation

**Files:**

- Modify: `README.md`
- Modify: `packages/render/README.md`

- [ ] **Step 1: Update the root README**

Add a "Demo-Ready Export Validation" section after "Exporting MP4 Artifacts":

````md
## Demo-Ready Export Validation

After a clean local checkout setup:

```bash
npm install
npm run build
npm run setup:browser
```
````

make sure `ffmpeg` and `ffprobe` are available on `PATH`, then run:

```bash
npm run validate:demo-ready
```

The validation copies `fixtures/export/basic-saved-variant` to a temporary
working directory before running `npm run autodemo -- export --project <copy>
--json`, so committed fixture files stay unchanged. A passing run creates and
inspects:

- `exports/baseline-polish.mp4`
- `exports/baseline-polish.render.json`

The validation bundle includes the synthetic fixture source media, source
metadata, saved `baseline-polish` variant metadata, MP4 artifact, render summary,
and these operator instructions. The fixture is synthetic and non-secret; it is
not marketing sample content.

Known MVP limitations: local-only checkout packaging, MP4-only export, no audio
track, no rendered captions/callouts/cursor overlays, approximate browser preview
rather than exact export parity, and no hosted or registry distribution.

````

- [ ] **Step 2: Update the render README**

Add a short "Demo-Ready Validation" section with the same command and expected artifact paths:

```md
## Demo-Ready Validation

Run the WES-165 operator validation from the repository root:

```bash
npm run validate:demo-ready
````

The command requires `ffmpeg` and `ffprobe` on `PATH`, copies
`fixtures/export/basic-saved-variant`, runs the repo-root wrapper export command,
and verifies `exports/baseline-polish.mp4` plus
`exports/baseline-polish.render.json`. The fixture is synthetic, local-only, and
MP4-only; audio tracks, rendered captions/callouts/cursor overlays, hosted
rendering, and registry distribution remain deferred.

````

- [ ] **Step 3: Run focused docs/fixture test**

Run: `rtk npm --workspace @auto-demo/render test -- src/render-docs.test.ts`

Expected: PASS.

### Task 4: Project Map, Verification, And Commit

**Files:**
- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: firstmate status file outside the repo as needed

- [ ] **Step 1: Update project map pre-completion evidence**

In `docs/linear/auto-demo-project-structure.md`, add the WES-165 spec and plan links to Local Context, update WES-165 state to In Progress if still present as Backlog, and add an investigation note:

```md
- 2026-07-07 WES-165 pre-task sync: Linear and the project map agree WES-165 is the last non-tracker Export And Packaging issue. WES-165 was moved to In Progress on branch `fm/wes-165-demo-ready-export-validation`. The selected scope is the canonical `fixtures/export/basic-saved-variant` project fixture, `npm run validate:demo-ready` operator validation command, expected `exports/baseline-polish.mp4` and `exports/baseline-polish.render.json` artifact checks, and concise MVP limitations; marketing assets, hosted rendering, non-MP4, audio, overlays, and package publication remain deferred.
````

- [ ] **Step 2: Run local verification**

Run:

```bash
rtk npm --workspace @auto-demo/render test -- src/render-docs.test.ts
rtk npm run validate:demo-ready
rtk npm run validate
rtk git diff --check
rtk git status --short
```

Expected: all commands exit 0; `git status --short` shows only scoped WES-165 changes.

- [ ] **Step 3: Commit scoped files**

Run:

```bash
git add package.json README.md packages/render/README.md packages/render/src/render-docs.test.ts scripts/validate-demo-ready-export.mjs fixtures/export/basic-saved-variant docs/superpowers/specs/2026-07-07-wes-165-demo-ready-export-validation-design.md docs/superpowers/plans/2026-07-07-wes-165-demo-ready-export-validation.md docs/linear/auto-demo-project-structure.md
git commit -m "feat(export): add demo-ready validation path"
```

Expected: commit succeeds on `fm/wes-165-demo-ready-export-validation`.

## Plan Self-Review

- Spec coverage: covers fixture, validation command, docs, behavior tests, local smoke verification, and project map pre-completion update.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: tests use existing `loadProject()` and existing render docs test helpers; script consumes current `autodemo export` JSON result shape.
