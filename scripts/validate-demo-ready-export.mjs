/* global URL, console, process */

import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const fixtureDir = join(repoRoot, "fixtures", "export", "basic-saved-variant");
const tempRoot = await mkdtemp(join(tmpdir(), "auto-demo-ready-export-"));
const projectCopy = join(tempRoot, "basic-saved-variant");

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
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

const exportResult = run("npm", [
  "--silent",
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
