import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  buildWorkspaceLevels,
  discoverWorkspaces,
  runWorkspaceTask,
  workspaceTaskCommand,
} from "./workspace-task-runner.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("workspace task graph", () => {
  it("orders dependencies before consumers and sorts independent workspaces", () => {
    assert.deepEqual(
      buildWorkspaceLevels([
        workspace("@auto-demo/render", []),
        workspace("@auto-demo/cli", ["@auto-demo/agent", "@auto-demo/render"]),
        workspace("@auto-demo/project", []),
        workspace("@auto-demo/agent", ["@auto-demo/project"]),
      ]),
      [
        ["@auto-demo/project", "@auto-demo/render"],
        ["@auto-demo/agent"],
        ["@auto-demo/cli"],
      ],
    );
  });

  it("rejects dependency cycles", () => {
    assert.throws(
      () =>
        buildWorkspaceLevels([
          workspace("@auto-demo/agent", ["@auto-demo/project"]),
          workspace("@auto-demo/project", ["@auto-demo/agent"]),
        ]),
      /cycle/i,
    );
  });

  it("rejects missing internal workspace dependencies", () => {
    assert.throws(
      () =>
        buildWorkspaceLevels([
          workspace("@auto-demo/agent", ["@auto-demo/missing"]),
        ]),
      /missing.*@auto-demo\/missing/i,
    );
  });
});

describe("workspace task command", () => {
  it("suppresses lifecycle hooks and forwards task arguments", () => {
    assert.deepEqual(
      workspaceTaskCommand("build", "@auto-demo/project", ["--reporter=junit"]),
      {
        command: "npm",
        args: [
          "run",
          "build",
          "--workspace",
          "@auto-demo/project",
          "--if-present",
          "--ignore-scripts",
          "--",
          "--reporter=junit",
        ],
      },
    );
  });

  it("rejects an empty task", () => {
    assert.throws(() => workspaceTaskCommand("", "@auto-demo/project"), /task/i);
  });
});

describe("workspace task execution", () => {
  it("discovers manifests and runs only packages that define the task", async () => {
    const repositoryRoot = await createRepository([
      {
        name: "@auto-demo/project",
        scripts: { build: "tsc -p tsconfig.json" },
      },
      {
        name: "@auto-demo/agent",
        dependencies: { "@auto-demo/project": "0.0.0" },
        scripts: { test: "vitest run" },
      },
    ]);
    const discovered = await discoverWorkspaces(repositoryRoot);

    assert.deepEqual(
      discovered.map(({ name, internalDependencies }) => ({ name, internalDependencies })),
      [
        { name: "@auto-demo/agent", internalDependencies: ["@auto-demo/project"] },
        { name: "@auto-demo/project", internalDependencies: [] },
      ],
    );

    const invocations = [];
    await runWorkspaceTask({
      repositoryRoot,
      task: "build",
      runCommand: async (invocation) => {
        invocations.push(invocation);
      },
    });

    assert.deepEqual(invocations, [
      {
        command: "npm",
        args: [
          "run",
          "build",
          "--workspace",
          "@auto-demo/project",
          "--if-present",
          "--ignore-scripts",
        ],
        cwd: repositoryRoot,
      },
    ]);
  });

  it("rejects when a child command fails", async () => {
    const repositoryRoot = await createRepository([
      {
        name: "@auto-demo/project",
        scripts: { build: "tsc -p tsconfig.json" },
      },
    ]);

    await assert.rejects(
      runWorkspaceTask({
        repositoryRoot,
        task: "build",
        runCommand: async () => {
          throw new Error("child exited 2");
        },
      }),
      /child exited 2/,
    );
  });
});

function workspace(name, internalDependencies) {
  return { name, internalDependencies, scripts: { build: "tsc" } };
}

async function createRepository(manifests) {
  const repositoryRoot = await mkdtemp(path.join(tmpdir(), "auto-demo-workspaces-"));
  temporaryDirectories.push(repositoryRoot);
  await Promise.all(
    manifests.map(async (manifest) => {
      const packageDirectory = path.join(
        repositoryRoot,
        "packages",
        manifest.name.replace("@auto-demo/", ""),
      );
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(
        path.join(packageDirectory, "package.json"),
        `${JSON.stringify({ version: "0.0.0", ...manifest }, null, 2)}\n`,
      );
    }),
  );
  return repositoryRoot;
}
