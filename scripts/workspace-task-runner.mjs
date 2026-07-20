/* global process */

import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INTERNAL_SCOPE = "@auto-demo/";

export async function discoverWorkspaces(repositoryRoot) {
  const packagesDirectory = path.join(repositoryRoot, "packages");
  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const workspaces = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const manifestPath = path.join(packagesDirectory, entry.name, "package.json");
        let manifest;
        try {
          manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        } catch (error) {
          throw new Error(
            `Unable to read workspace manifest: packages/${entry.name}/package.json`,
            {
              cause: error,
            },
          );
        }
        if (typeof manifest.name !== "string" || manifest.name.length === 0) {
          throw new Error(
            `Workspace manifest is missing a name: packages/${entry.name}/package.json`,
          );
        }
        const dependencies = {
          ...objectValue(manifest.dependencies),
          ...objectValue(manifest.devDependencies),
          ...objectValue(manifest.optionalDependencies),
          ...objectValue(manifest.peerDependencies),
        };
        return {
          name: manifest.name,
          directory: path.join(packagesDirectory, entry.name),
          internalDependencies: Object.keys(dependencies)
            .filter((name) => name.startsWith(INTERNAL_SCOPE))
            .sort(),
          scripts: objectValue(manifest.scripts),
        };
      }),
  );
  return workspaces.sort((left, right) => left.name.localeCompare(right.name));
}

export function buildWorkspaceLevels(workspaces) {
  const workspaceByName = new Map();
  for (const workspace of workspaces) {
    if (workspaceByName.has(workspace.name)) {
      throw new Error(`Duplicate workspace name: ${workspace.name}`);
    }
    workspaceByName.set(workspace.name, workspace);
  }

  const consumersByDependency = new Map(
    [...workspaceByName.keys()].map((name) => [name, new Set()]),
  );
  const remainingDependencies = new Map();
  for (const workspace of workspaceByName.values()) {
    const dependencies = new Set(workspace.internalDependencies);
    for (const dependency of dependencies) {
      if (!workspaceByName.has(dependency)) {
        throw new Error(
          `Missing internal workspace dependency ${dependency} for ${workspace.name}`,
        );
      }
      consumersByDependency.get(dependency).add(workspace.name);
    }
    remainingDependencies.set(workspace.name, dependencies.size);
  }

  const levels = [];
  let ready = [...remainingDependencies]
    .filter(([, dependencyCount]) => dependencyCount === 0)
    .map(([name]) => name)
    .sort();
  let visited = 0;
  while (ready.length > 0) {
    levels.push(ready);
    visited += ready.length;
    const next = [];
    for (const dependency of ready) {
      for (const consumer of consumersByDependency.get(dependency)) {
        const remaining = remainingDependencies.get(consumer) - 1;
        remainingDependencies.set(consumer, remaining);
        if (remaining === 0) next.push(consumer);
      }
    }
    ready = next.sort();
  }
  if (visited !== workspaces.length) {
    const cyclicNames = [...remainingDependencies]
      .filter(([, dependencyCount]) => dependencyCount > 0)
      .map(([name]) => name)
      .sort();
    throw new Error(`Workspace dependency cycle: ${cyclicNames.join(", ")}`);
  }
  return levels;
}

export function workspaceTaskCommand(task, workspaceName, taskArguments = []) {
  if (typeof task !== "string" || task.length === 0) {
    throw new Error("Workspace task is required.");
  }
  const args = ["run", task, "--workspace", workspaceName, "--if-present", "--ignore-scripts"];
  if (taskArguments.length > 0) args.push("--", ...taskArguments);
  return { command: "npm", args };
}

export async function runWorkspaceTask({
  repositoryRoot,
  task,
  taskArguments = [],
  runCommand = spawnCommand,
}) {
  const workspaces = await discoverWorkspaces(repositoryRoot);
  const workspaceByName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const levels = buildWorkspaceLevels(workspaces);
  for (const level of levels) {
    await Promise.all(
      level
        .map((name) => workspaceByName.get(name))
        .filter((workspace) => typeof workspace.scripts[task] === "string")
        .map(async (workspace) => {
          const command = workspaceTaskCommand(task, workspace.name, taskArguments);
          await runCommand({ ...command, cwd: repositoryRoot });
        }),
    );
  }
}

async function spawnCommand({ command, args, cwd }) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal === null
            ? `${command} exited with code ${code ?? "unknown"}`
            : `${command} exited from signal ${signal}`,
        ),
      );
    });
  });
}

function objectValue(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isMainModule() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const [task, ...rawTaskArguments] = process.argv.slice(2);
  const taskArguments = rawTaskArguments[0] === "--" ? rawTaskArguments.slice(1) : rawTaskArguments;
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  runWorkspaceTask({ repositoryRoot, task, taskArguments }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Workspace task failed."}\n`);
    process.exitCode = 1;
  });
}
