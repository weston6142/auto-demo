import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.join(repositoryRoot, ".github", "workflows", "ci.yml");

describe("GitHub CI workflow contract", () => {
  it("retains pull-request and develop-push validation with superseded-run cancellation", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    assert.match(workflow, /^name: CI$/m);
    assert.match(workflow, /^ {2}pull_request:$/m);
    assert.match(workflow, /^ {2}push:\n {4}branches:\n {6}- develop$/m);
    assert.match(workflow, /^concurrency:$/m);
    assert.match(workflow, /group: ci-.*github\.event\.pull_request\.number.*github\.ref/);
    assert.match(workflow, /cancel-in-progress: true/);
    assert.equal(matches(workflow, /uses: actions\/checkout@v7/g), 7);
    assert.equal(matches(workflow, /uses: actions\/setup-node@v6/g), 4);
    assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node)@v4/);
  });

  it("runs static, docs, unit, browser, and macOS native responsibilities independently", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    for (const job of [
      "changes",
      "static",
      "docs",
      "unit",
      "browser",
      "macos-native",
      "validate",
    ]) {
      assert.match(workflow, new RegExp(`^  ${job}:$`, "m"));
    }
    assert.equal(matches(workflow, /playwright install --with-deps chromium/g), 1);
    assert.match(jobBlock(workflow, "unit"), /if: needs\.changes\.outputs\.route == 'full'/);
    assert.match(jobBlock(workflow, "browser"), /if: needs\.changes\.outputs\.route == 'full'/);
    assert.match(jobBlock(workflow, "static"), /npm run typecheck:ci/);
    assert.match(jobBlock(workflow, "docs"), /npm run test:docs:ci/);
    assert.match(jobBlock(workflow, "unit"), /npm run test:unit:ci/);
    const macosNative = jobBlock(workflow, "macos-native");
    assert.match(macosNative, /runs-on: macos-latest/);
    assert.match(macosNative, /swift test --package-path native\/macos-capture-helper/);
    assert.match(macosNative, /AutoDemoCaptureSupervisor/);
    assert.doesNotMatch(macosNative, /request-permission|AUTODEMO_REAL_CAPTURE_HELPER/);
  });

  it("preserves browser failure output and machine-readable reports", async () => {
    const browser = jobBlock(await readFile(workflowPath, "utf8"), "browser");
    assert.match(browser, /set -o pipefail/);
    assert.match(browser, /tee artifacts\/browser-tests\.log/);
    for (const report of ["agent.xml", "capture.xml", "cli.xml"]) {
      assert.match(browser, new RegExp(`artifacts/${report.replace(".", "\\.")}`));
    }
    assert.match(browser, /uses: actions\/upload-artifact@v4/);
    assert.match(browser, /if: failure\(\)/);
    assert.match(browser, /retention-days: 7/);
  });

  it("keeps a stable always-running fail-closed validate job", async () => {
    const validate = jobBlock(await readFile(workflowPath, "utf8"), "validate");
    assert.match(validate, /^ {2}validate:\n {4}name: validate$/m);
    assert.match(validate, /if: always\(\)/);
    assert.match(validate, /needs: \[changes, static, docs, unit, browser, macos-native\]/);
    assert.match(validate, /node scripts\/ci-policy\.mjs gate/);
    for (const result of [
      "needs.static.result",
      "needs.docs.result",
      "needs.unit.result",
      "needs.browser.result",
      "needs.macos-native.result",
    ]) {
      assert.match(validate, new RegExp(result.replaceAll(".", "\\.")));
    }
  });
});

function matches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function jobBlock(workflow, job) {
  const marker = `  ${job}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `missing ${job} job`);
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/^ {2}[a-z][a-z-]*:\n/m);
  return workflow.slice(start, nextJob === -1 ? workflow.length : start + marker.length + nextJob);
}
