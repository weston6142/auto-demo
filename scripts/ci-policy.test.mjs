import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, it } from "node:test";
import { classifyChangedPaths, runCiPolicy, validateCiResults } from "./ci-policy.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CI change classification", () => {
  it("uses the reduced route only when every changed path is Markdown", () => {
    assert.equal(classifyChangedPaths(["README.md", "docs/guide.md"]), "docs-only");
    assert.equal(classifyChangedPaths(["README.MD"]), "docs-only");
    assert.equal(classifyChangedPaths(["README.md", "package.json"]), "full");
    assert.equal(classifyChangedPaths([".github/workflows/ci.yml"]), "full");
    assert.equal(classifyChangedPaths([]), "full");
  });

  it("classifies the exact Git diff and writes a GitHub output", async () => {
    const repository = await createGitRepository();
    const base = git(repository, "rev-parse", "HEAD");
    await mkdir(path.join(repository, "docs"));
    await writeFile(path.join(repository, "docs", "guide.md"), "# Guide\n");
    git(repository, "add", "docs/guide.md");
    git(repository, "commit", "-m", "docs");
    const head = git(repository, "rev-parse", "HEAD");
    const outputFile = path.join(repository, "github-output.txt");

    await runCiPolicy(["classify", base, head], { cwd: repository, outputFile });

    assert.equal(await readFile(outputFile, "utf8"), "route=docs-only\n");
  });
});

describe("CI final gate", () => {
  it("accepts only the complete full route", () => {
    assert.deepEqual(
      validateCiResults({
        route: "full",
        static: "success",
        docs: "success",
        unit: "success",
        browser: "success",
      }),
      { ok: true, errors: [] },
    );
    assert.equal(
      validateCiResults({
        route: "full",
        static: "success",
        docs: "success",
        unit: "skipped",
        browser: "success",
      }).ok,
      false,
    );
  });

  it("accepts intentional expensive-job skips only for docs-only changes", () => {
    assert.deepEqual(
      validateCiResults({
        route: "docs-only",
        static: "success",
        docs: "success",
        unit: "skipped",
        browser: "skipped",
      }),
      { ok: true, errors: [] },
    );
    for (const unacceptable of ["failure", "cancelled", "skipped", "unknown"]) {
      assert.equal(
        validateCiResults({
          route: "docs-only",
          static: unacceptable,
          docs: "success",
          unit: "skipped",
          browser: "skipped",
        }).ok,
        false,
      );
      assert.equal(
        validateCiResults({
          route: "docs-only",
          static: "success",
          docs: unacceptable,
          unit: "skipped",
          browser: "skipped",
        }).ok,
        false,
      );
    }
  });

  it("fails closed for an unknown route or unexpected skip", () => {
    assert.equal(
      validateCiResults({
        route: "other",
        static: "success",
        docs: "success",
        unit: "success",
        browser: "success",
      }).ok,
      false,
    );
    assert.equal(
      validateCiResults({
        route: "docs-only",
        static: "success",
        docs: "success",
        unit: "success",
        browser: "skipped",
      }).ok,
      false,
    );
  });

  it("rejects an unacceptable gate through the CLI contract", async () => {
    await assert.rejects(
      runCiPolicy(["gate", "full", "success", "success", "failure", "success"]),
      /unit.*failure/i,
    );
  });
});

async function createGitRepository() {
  const repository = await mkdtemp(path.join(tmpdir(), "auto-demo-ci-policy-"));
  temporaryDirectories.push(repository);
  git(repository, "init", "-q");
  git(repository, "config", "user.email", "ci-policy@example.test");
  git(repository, "config", "user.name", "CI Policy Test");
  await writeFile(path.join(repository, "README.md"), "# Test\n");
  git(repository, "add", "README.md");
  git(repository, "commit", "-m", "initial");
  return repository;
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
