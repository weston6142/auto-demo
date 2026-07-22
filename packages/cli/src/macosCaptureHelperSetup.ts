import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

const HELPER_APP_NAME = "Auto Demo Capture.app";
const HELPER_EXECUTABLE_NAME = "AutoDemoCaptureHelper";
const HELPER_BUNDLE_IDENTIFIER = "com.autodemo.capture-helper";

export type CaptureHelperSetupResult =
  | {
      ok: true;
      code: "capture_helper_ready";
      installPath: string;
      signature: "development" | "ad-hoc";
    }
  | {
      ok: false;
      code:
        | "unsupported_platform"
        | "signing_identity_required"
        | "invalid_signing_identity"
        | "capture_helper_build_failed"
        | "capture_helper_install_failed"
        | "capture_helper_signature_invalid"
        | "capture_helper_permission_required";
      message: string;
      choices?: CodeSigningIdentity[];
    };

export type CaptureHelperSetupInput = {
  signingIdentity?: string;
  adHoc: boolean;
  json: true;
};

export type CodeSigningIdentity = {
  fingerprint: string;
  label: string;
};

export type CaptureHelperSetupDependencies = {
  platform: NodeJS.Platform;
  repositoryRoot: string;
  homeDirectory: string;
  runCommand(command: string, args: string[]): Promise<{ exitCode: number; stdout: string }>;
};

export function defaultCaptureHelperSetupDependencies(
  repositoryRoot: string,
): CaptureHelperSetupDependencies {
  return {
    platform: process.platform,
    repositoryRoot,
    homeDirectory: homedir(),
    runCommand,
  };
}

export function parseCodeSigningIdentities(output: string): CodeSigningIdentity[] {
  const identities: CodeSigningIdentity[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const match = /^\s*\d+\)\s+([A-F0-9]{40})\s+"(Apple Development:[^"]+)"\s*$/u.exec(
      line,
    );
    if (match === null) continue;
    identities.push({ fingerprint: match[1]!, label: match[2]! });
  }
  return identities;
}

export async function runMacOsCaptureHelperSetup(
  input: CaptureHelperSetupInput,
  dependencies: CaptureHelperSetupDependencies,
): Promise<CaptureHelperSetupResult> {
  if (dependencies.platform !== "darwin") {
    return failure(
      "unsupported_platform",
      "Auto Demo Capture is supported only on macOS.",
    );
  }
  const nativeRoot = join(dependencies.repositoryRoot, "native/macos-capture-helper");
  const installPath = join(dependencies.homeDirectory, "Applications", HELPER_APP_NAME);
  const sourceHash = await hashSourceTree(nativeRoot).catch(() => undefined);
  if (sourceHash === undefined) {
    return failure("capture_helper_build_failed", "Auto Demo Capture could not be built.");
  }

  const currentSignature = await currentInstallSignature(
    installPath,
    sourceHash,
    dependencies,
  );
  if (currentSignature !== undefined) {
    return await permissionResult(installPath, currentSignature, dependencies);
  }

  const signing = await resolveSigning(input, dependencies);
  if (!signing.ok) return signing.result;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "auto-demo-capture-helper-"));
  const temporaryApp = join(temporaryDirectory, HELPER_APP_NAME);
  const backupPath = `${installPath}.backup-${randomUUID()}`;
  let movedExisting = false;
  try {
    const scratchPath = join(temporaryDirectory, "swift");
    const built = await dependencies.runCommand("swift", [
      "build",
      "--package-path",
      nativeRoot,
      "--configuration",
      "release",
      "--scratch-path",
      scratchPath,
    ]);
    if (built.exitCode !== 0) {
      return failure("capture_helper_build_failed", "Auto Demo Capture could not be built.");
    }
    await createAppBundle({
      nativeRoot,
      scratchPath,
      appPath: temporaryApp,
      sourceHash,
      signature: signing.signature,
    });
    const signed = await dependencies.runCommand("codesign", [
      "--force",
      "--sign",
      signing.identity,
      "--identifier",
      HELPER_BUNDLE_IDENTIFIER,
      temporaryApp,
    ]);
    if (signed.exitCode !== 0 || !(await verifySignature(temporaryApp, dependencies))) {
      return failure(
        "capture_helper_signature_invalid",
        "Auto Demo Capture signature validation failed.",
      );
    }

    await mkdir(dirname(installPath), { recursive: true });
    if (await pathExists(installPath)) {
      await rename(installPath, backupPath);
      movedExisting = true;
    }
    await rename(temporaryApp, installPath);
    if (!(await verifyInstalledHelper(installPath, dependencies))) {
      await rm(installPath, { recursive: true, force: true });
      if (movedExisting) await rename(backupPath, installPath);
      movedExisting = false;
      return failure(
        "capture_helper_install_failed",
        "Auto Demo Capture installation validation failed.",
      );
    }
    if (movedExisting) {
      await rm(backupPath, { recursive: true, force: true });
      movedExisting = false;
    }
    return await permissionResult(installPath, signing.signature, dependencies);
  } catch {
    if (!(await pathExists(installPath)) && movedExisting) {
      await rename(backupPath, installPath).catch(() => undefined);
    }
    return failure(
      "capture_helper_install_failed",
      "Auto Demo Capture could not be installed.",
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function resolveSigning(
  input: CaptureHelperSetupInput,
  dependencies: CaptureHelperSetupDependencies,
): Promise<
  | { ok: true; identity: string; signature: "development" | "ad-hoc" }
  | { ok: false; result: CaptureHelperSetupResult }
> {
  if (input.adHoc) return { ok: true, identity: "-", signature: "ad-hoc" };
  const listed = await dependencies.runCommand("security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning",
  ]);
  const choices = listed.exitCode === 0 ? parseCodeSigningIdentities(listed.stdout) : [];
  if (input.signingIdentity !== undefined) {
    const selected = choices.find((choice) => choice.fingerprint === input.signingIdentity);
    return selected === undefined
      ? {
          ok: false,
          result: failure(
            "invalid_signing_identity",
            "The selected Apple Development signing identity is unavailable.",
          ),
        }
      : { ok: true, identity: selected.fingerprint, signature: "development" };
  }
  if (choices.length !== 1) {
    return {
      ok: false,
      result: {
        ok: false,
        code: "signing_identity_required",
        message: "Select one local Apple Development signing identity or use --ad-hoc.",
        choices,
      },
    };
  }
  return { ok: true, identity: choices[0]!.fingerprint, signature: "development" };
}

async function createAppBundle(input: {
  nativeRoot: string;
  scratchPath: string;
  appPath: string;
  sourceHash: string;
  signature: "development" | "ad-hoc";
}): Promise<void> {
  const contents = join(input.appPath, "Contents");
  const executableDirectory = join(contents, "MacOS");
  const resources = join(contents, "Resources");
  await mkdir(executableDirectory, { recursive: true });
  await mkdir(resources, { recursive: true });
  await copyFile(join(input.nativeRoot, "Resources/Info.plist"), join(contents, "Info.plist"));
  const executable = join(executableDirectory, HELPER_EXECUTABLE_NAME);
  await copyFile(
    join(input.scratchPath, "release", HELPER_EXECUTABLE_NAME),
    executable,
  );
  await chmod(executable, 0o755);
  await writeFile(join(resources, "source-hash"), `${input.sourceHash}\n`, { mode: 0o644 });
  await writeFile(join(resources, "signature-kind"), `${input.signature}\n`, { mode: 0o644 });
}

async function currentInstallSignature(
  installPath: string,
  sourceHash: string,
  dependencies: CaptureHelperSetupDependencies,
): Promise<"development" | "ad-hoc" | undefined> {
  try {
    const installedHash = (
      await readFile(join(installPath, "Contents/Resources/source-hash"), "utf8")
    ).trim();
    const signature = (
      await readFile(join(installPath, "Contents/Resources/signature-kind"), "utf8")
    ).trim();
    if (
      installedHash !== sourceHash ||
      (signature !== "development" && signature !== "ad-hoc") ||
      !(await verifySignature(installPath, dependencies)) ||
      !(await verifyInstalledHelper(installPath, dependencies))
    ) {
      return undefined;
    }
    return signature;
  } catch {
    return undefined;
  }
}

async function verifySignature(
  appPath: string,
  dependencies: CaptureHelperSetupDependencies,
): Promise<boolean> {
  const result = await dependencies.runCommand("codesign", [
    "--verify",
    "--strict",
    "--verbose=2",
    appPath,
  ]);
  return result.exitCode === 0;
}

async function verifyInstalledHelper(
  appPath: string,
  dependencies: CaptureHelperSetupDependencies,
): Promise<boolean> {
  const executable = join(appPath, "Contents/MacOS", HELPER_EXECUTABLE_NAME);
  const result = await dependencies.runCommand(executable, ["--version-json"]);
  if (result.exitCode !== 0) return false;
  try {
    const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
    return (
      parsed.ok === true &&
      parsed.protocolVersion === 1 &&
      parsed.bundleIdentifier === HELPER_BUNDLE_IDENTIFIER
    );
  } catch {
    return false;
  }
}

async function permissionResult(
  installPath: string,
  signature: "development" | "ad-hoc",
  dependencies: CaptureHelperSetupDependencies,
): Promise<CaptureHelperSetupResult> {
  const executable = join(installPath, "Contents/MacOS", HELPER_EXECUTABLE_NAME);
  const preflight = await dependencies.runCommand(executable, ["--preflight-json"]);
  if (preflight.exitCode === 0 && jsonOk(preflight.stdout)) {
    return { ok: true, code: "capture_helper_ready", installPath, signature };
  }
  const requested = await dependencies.runCommand(executable, ["--request-permission-json"]);
  return requested.exitCode === 0 && jsonOk(requested.stdout)
    ? { ok: true, code: "capture_helper_ready", installPath, signature }
    : failure(
        "capture_helper_permission_required",
        "Auto Demo Capture needs Screen Recording permission.",
      );
}

function jsonOk(value: string): boolean {
  try {
    return (JSON.parse(value) as Record<string, unknown>).ok === true;
  } catch {
    return false;
  }
}

async function hashSourceTree(root: string): Promise<string> {
  const files = await collectFiles(root);
  const hash = createHash("sha256");
  for (const path of files) {
    const relativePath = relative(root, path);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === ".build") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) result.push(path);
    }
  }
  await visit(root);
  return result;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function failure(
  code: Extract<CaptureHelperSetupResult, { ok: false }>["code"],
  message: string,
): Extract<CaptureHelperSetupResult, { ok: false }> {
  return { ok: false, code, message };
}

function runCommand(
  command: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: "utf8", maxBuffer: 1_000_000, timeout: 120_000 },
      (error, stdout) => {
        resolve({
          exitCode:
            error === null
              ? 0
              : typeof error.code === "number"
                ? error.code
                : 1,
          stdout,
        });
      },
    );
  });
}
