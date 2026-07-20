import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packages = [
  "agent",
  "browser-profile",
  "capture",
  "cli",
  "editor",
  "polish",
  "project",
  "render",
];

const expectedBrowserTests = new Set([
  "agent/src/playwrightDiscoveryObservation.test.ts",
  "agent/src/playwrightDiscoveryPolicyGuard.test.ts",
  "agent/src/playwrightDiscoveryRehearsal.test.ts",
  "agent/src/playwrightDiscoveryReplay.test.ts",
  "agent/src/playwrightPolicyDiscoveryRehearsal.test.ts",
  "capture/src/playwrightExecutionController.test.ts",
  "capture/src/playwrightMetadataRecorder.test.ts",
  "cli/src/agenticDiscoveryAcceptance.test.ts",
]);

const expectedDocsTests = new Set([
  "agent/src/wrapper-docs.test.ts",
  "cli/src/packaging-docs.test.ts",
  "render/src/render-docs.test.ts",
]);

describe("CI test partitions", () => {
  it("assigns every workspace test to exactly one runtime partition", async () => {
    const actualBrowserTests = new Set();
    const actualDocsTests = new Set();
    for (const packageDirectory of packages) {
      const manifest = await readManifest(packageDirectory);
      const complete = testFiles(manifest.scripts.test);
      const partitions = ["test:unit", "test:docs", "test:browser"].map((script) => ({
        script,
        files: testFiles(manifest.scripts[script]),
      }));
      const memberships = new Map([...complete].map((file) => [file, []]));
      for (const partition of partitions) {
        for (const file of partition.files) {
          assert.ok(complete.has(file), `${packageDirectory}/${file} is absent from test`);
          memberships.get(file).push(partition.script);
          if (partition.script === "test:browser") {
            actualBrowserTests.add(`${packageDirectory}/${file}`);
          }
          if (partition.script === "test:docs") {
            actualDocsTests.add(`${packageDirectory}/${file}`);
          }
        }
      }
      for (const [file, scripts] of memberships) {
        assert.deepEqual(
          scripts,
          [scripts[0]],
          `${packageDirectory}/${file} must belong to exactly one partition`,
        );
        assert.equal(
          scripts.length,
          1,
          `${packageDirectory}/${file} must belong to exactly one partition`,
        );
      }
    }
    assert.deepEqual(actualBrowserTests, expectedBrowserTests);
    assert.deepEqual(actualDocsTests, expectedDocsTests);
  });

  it("uses the lifecycle-free runner for root CI composition", async () => {
    const manifest = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8"));
    assert.equal(manifest.scripts.build, "node scripts/workspace-task-runner.mjs build");
    assert.equal(
      manifest.scripts["typecheck:ci"],
      "node scripts/workspace-task-runner.mjs typecheck",
    );
    assert.match(manifest.scripts["test:unit:ci"], /workspace-task-runner\.mjs test:unit/);
    assert.equal(
      manifest.scripts["test:docs:ci"],
      "node scripts/workspace-task-runner.mjs test:docs",
    );
    assert.equal(
      manifest.scripts["test:browser:ci"],
      "node scripts/workspace-task-runner.mjs test:browser",
    );
    assert.equal(
      manifest.scripts.validate,
      "npm run build && npm run typecheck:ci && npm run lint && npm run test:ci && npm run format:check",
    );
  });
});

async function readManifest(packageDirectory) {
  return JSON.parse(
    await readFile(path.join(repositoryRoot, "packages", packageDirectory, "package.json"), "utf8"),
  );
}

function testFiles(command) {
  if (typeof command !== "string") return new Set();
  return new Set(command.match(/src\/[^\s]+\.test\.ts/g) ?? []);
}
