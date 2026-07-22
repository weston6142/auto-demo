/* global process */

import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SUCCESS = "success";
const SKIPPED = "skipped";

export function classifyChangedPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0) return "full";
  return paths.every((changedPath) => typeof changedPath === "string" && /\.md$/i.test(changedPath))
    ? "docs-only"
    : "full";
}

export function validateCiResults(results) {
  const errors = [];
  if (results.route === "full") {
    for (const job of ["static", "docs", "unit", "browser", "macosNative"]) {
      if (results[job] !== SUCCESS) errors.push(`${job} was ${results[job] ?? "missing"}`);
    }
  } else if (results.route === "docs-only") {
    for (const job of ["static", "docs"]) {
      if (results[job] !== SUCCESS) errors.push(`${job} was ${results[job] ?? "missing"}`);
    }
    for (const job of ["unit", "browser", "macosNative"]) {
      if (results[job] !== SKIPPED) {
        errors.push(`${job} was ${results[job] ?? "missing"}; expected skipped`);
      }
    }
  } else {
    errors.push(`route was ${results.route ?? "missing"}`);
  }
  return { ok: errors.length === 0, errors };
}

export async function runCiPolicy(
  arguments_,
  {
    cwd = process.cwd(),
    outputFile = process.env.GITHUB_OUTPUT,
    runGitDiff = gitChangedPaths,
  } = {},
) {
  const [mode, ...values] = arguments_;
  if (mode === "classify") {
    const [base, head] = values;
    let changedPaths = [];
    if (isCommitish(base) && isCommitish(head)) {
      try {
        changedPaths = await runGitDiff({ cwd, base, head });
      } catch {
        changedPaths = [];
      }
    }
    const route = classifyChangedPaths(changedPaths);
    if (typeof outputFile !== "string" || outputFile.length === 0) {
      throw new Error("GITHUB_OUTPUT is required for change classification.");
    }
    await appendFile(outputFile, `route=${route}\n`);
    return { route };
  }
  if (mode === "gate") {
    const [route, staticResult, docs, unit, browser, macosNative] = values;
    const result = validateCiResults({
      route,
      static: staticResult,
      docs,
      unit,
      browser,
      macosNative,
    });
    if (!result.ok) throw new Error(`CI validation failed: ${result.errors.join("; ")}`);
    return result;
  }
  throw new Error("CI policy mode must be classify or gate.");
}

async function gitChangedPaths({ cwd, base, head }) {
  const output = await spawnForOutput("git", ["diff", "--name-only", "--no-renames", base, head], {
    cwd,
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

async function spawnForOutput(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`));
    });
  });
}

function isCommitish(value) {
  return typeof value === "string" && /^[0-9a-f]{7,64}$/i.test(value) && !/^0+$/.test(value);
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  runCiPolicy(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "CI policy failed."}\n`);
    process.exitCode = 1;
  });
}
