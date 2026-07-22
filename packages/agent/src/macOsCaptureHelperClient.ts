import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const SETUP_COMMAND = "npm run autodemo -- setup capture-helper --json" as const;
const HELPER_APP_NAME = "Auto Demo Capture.app";
const HELPER_EXECUTABLE = "Contents/MacOS/AutoDemoCaptureHelper";
const SUPERVISOR_EXECUTABLE = "Contents/MacOS/AutoDemoCaptureSupervisor";
const MAXIMUM_RESPONSE_BYTES = 32 * 1_024 * 1_024;
const MAXIMUM_HEADER_BYTES = 8 * 1_024;
const MAXIMUM_PROBE_BYTES = 16 * 1_024;

export type MacOsCaptureRegion = { x: number; y: number; width: number; height: number };

export type MacOsCaptureHelperClient = {
  capture(region: MacOsCaptureRegion): Promise<Uint8Array | undefined>;
  close(): Promise<void>;
};

export type MacOsCaptureHelperPreflightResult =
  | { ok: true; installPath: string; protocolVersion: 1 }
  | {
      ok: false;
      code:
        | "capture_helper_not_installed"
        | "capture_helper_signature_invalid"
        | "capture_helper_protocol_mismatch"
        | "capture_helper_permission_required"
        | "capture_helper_unavailable";
      message: string;
      setupCommand: typeof SETUP_COMMAND;
    };

export type CaptureHelperChildProcess = {
  exitCode: number | null;
  kill(signal: NodeJS.Signals): boolean;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
  once(event: "error", listener: (error: Error) => void): unknown;
};

export type MacOsCaptureHelperDependencies = {
  platform: NodeJS.Platform;
  homeDirectory: string;
  temporaryDirectory: string;
  runCommand(
    command: string,
    args: string[],
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  launch(executable: string, args: string[]): CaptureHelperChildProcess;
};

export type CreateMacOsCaptureHelperClientInput = {
  sessionDirectory: string;
  installPath: string;
  requestTimeoutMs?: number;
  dependencies?: MacOsCaptureHelperDependencies;
};

export type MacOsCaptureHelperProbeMode = "version" | "permission-preflight" | "permission-request";

export type MacOsCaptureHelperProbeResult = {
  ok: boolean;
  code: string;
  message?: string;
  values: Record<string, string | number>;
};

export function defaultMacOsCaptureHelperDependencies(): MacOsCaptureHelperDependencies {
  return {
    platform: process.platform,
    homeDirectory: homedir(),
    temporaryDirectory: tmpdir(),
    runCommand,
    launch(executable, args) {
      return spawn(executable, args, { stdio: "ignore" });
    },
  };
}

export async function preflightMacOsCaptureHelper(
  dependencies: MacOsCaptureHelperDependencies = defaultMacOsCaptureHelperDependencies(),
): Promise<MacOsCaptureHelperPreflightResult> {
  const installPath = join(dependencies.homeDirectory, "Applications", HELPER_APP_NAME);
  if (
    !(await isRegularBundledExecutable(join(installPath, HELPER_EXECUTABLE))) ||
    !(await isRegularBundledExecutable(join(installPath, SUPERVISOR_EXECUTABLE)))
  ) {
    return preflightFailure("capture_helper_not_installed", "Auto Demo Capture is not installed.");
  }
  const signature = await dependencies.runCommand("codesign", [
    "--verify",
    "--strict",
    "--verbose=2",
    installPath,
  ]);
  if (signature.exitCode !== 0) {
    return preflightFailure(
      "capture_helper_signature_invalid",
      "Auto Demo Capture signature validation failed.",
    );
  }
  const version = await runMacOsCaptureHelperProbe({
    installPath,
    mode: "version",
    dependencies,
  });
  if (!validVersion(version)) {
    return preflightFailure(
      "capture_helper_protocol_mismatch",
      "Auto Demo Capture protocol is incompatible.",
    );
  }
  const permission = await runMacOsCaptureHelperProbe({
    installPath,
    mode: "permission-preflight",
    dependencies,
  });
  if (permission === undefined) {
    return preflightFailure(
      "capture_helper_unavailable",
      "Auto Demo Capture could not complete its permission check.",
    );
  }
  if (!permission.ok || permission.code !== "capture_helper_permission_granted") {
    return preflightFailure(
      "capture_helper_permission_required",
      "Auto Demo Capture needs Screen Recording permission.",
    );
  }
  return { ok: true, installPath, protocolVersion: 1 };
}

export async function runMacOsCaptureHelperProbe(input: {
  installPath: string;
  mode: MacOsCaptureHelperProbeMode;
  dependencies?: MacOsCaptureHelperDependencies;
}): Promise<MacOsCaptureHelperProbeResult | undefined> {
  const dependencies = input.dependencies ?? defaultMacOsCaptureHelperDependencies();
  const supervisor = join(input.installPath, SUPERVISOR_EXECUTABLE);
  if (!(await isRegularBundledExecutable(supervisor))) return undefined;
  const directory = await mkdtemp(join(dependencies.temporaryDirectory, "adc-probe-"));
  await chmod(directory, 0o700);
  const requestPath = join(directory, "request.json");
  const responsePath = join(directory, "response.json");
  try {
    await writeFile(
      requestPath,
      `${JSON.stringify({
        protocolVersion: 1,
        mode: input.mode,
        responsePath,
      })}\n`,
      { flag: "wx", mode: 0o600 },
    );
    const launched = await dependencies.runCommand(supervisor, ["--launch-request", requestPath]);
    if (launched.exitCode !== 0) return undefined;
    const metadata = await lstat(responsePath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      (metadata.mode & 0o077) !== 0 ||
      metadata.size < 1 ||
      metadata.size > MAXIMUM_PROBE_BYTES
    ) {
      return undefined;
    }
    return parseProbeResult(await readFile(responsePath, "utf8"));
  } catch {
    return undefined;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export async function createMacOsCaptureHelperClient(
  input: CreateMacOsCaptureHelperClientInput,
): Promise<MacOsCaptureHelperClient> {
  const dependencies = input.dependencies ?? defaultMacOsCaptureHelperDependencies();
  const supervisor = join(input.installPath, SUPERVISOR_EXECUTABLE);
  const token = randomBytes(32).toString("hex");
  const socketDirectory = await mkdtemp(join(dependencies.temporaryDirectory, "adc-"));
  await chmod(socketDirectory, 0o700);
  const socketPath = join(socketDirectory, "capture.sock");
  const bootstrapPath = join(
    input.sessionDirectory,
    `capture-helper-bootstrap-${randomBytes(6).toString("hex")}.json`,
  );
  await writeFile(
    bootstrapPath,
    `${JSON.stringify({
      protocolVersion: 1,
      socketPath,
      token,
      idleTimeoutMs: 30_000,
    })}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const launchRequestPath = join(socketDirectory, "launch-request.json");
  await writeFile(
    launchRequestPath,
    `${JSON.stringify({
      protocolVersion: 1,
      mode: "service",
      bootstrapPath,
    })}\n`,
    { flag: "wx", mode: 0o600 },
  );
  const child = dependencies.launch(supervisor, ["--launch-request", launchRequestPath]);
  let closed = false;
  try {
    await waitForSocket(socketPath, child);
  } catch (error) {
    await stopChild(child);
    await cleanup(bootstrapPath, socketDirectory);
    throw error;
  }

  return {
    async capture(region) {
      if (closed || !validRegion(region)) return undefined;
      return await captureFromSocket({
        socketPath,
        token,
        region,
        timeoutMs: input.requestTimeoutMs ?? 5_000,
      }).catch(() => undefined);
    },
    async close() {
      if (closed) return;
      closed = true;
      await stopChild(child);
      await cleanup(bootstrapPath, socketDirectory);
    },
  };
}

function validVersion(result: MacOsCaptureHelperProbeResult | undefined): boolean {
  return (
    result?.ok === true &&
    result.code === "capture_helper_version" &&
    result.values.protocolVersion === 1 &&
    result.values.bundleIdentifier === "com.autodemo.capture-helper"
  );
}

function parseProbeResult(value: string): MacOsCaptureHelperProbeResult | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (Object.keys(record).some((key) => !["ok", "code", "message", "values"].includes(key))) {
      return undefined;
    }
    if (
      typeof record.ok !== "boolean" ||
      typeof record.code !== "string" ||
      record.code.length < 1 ||
      record.code.length > 128 ||
      (record.message !== undefined &&
        (typeof record.message !== "string" || record.message.length > 512)) ||
      typeof record.values !== "object" ||
      record.values === null ||
      Array.isArray(record.values)
    ) {
      return undefined;
    }
    const values = record.values as Record<string, unknown>;
    if (
      Object.keys(values).length > 16 ||
      Object.entries(values).some(
        ([key, item]) =>
          key.length < 1 ||
          key.length > 64 ||
          !(
            (typeof item === "string" && item.length <= 512) ||
            (typeof item === "number" && Number.isSafeInteger(item))
          ),
      )
    ) {
      return undefined;
    }
    return {
      ok: record.ok,
      code: record.code,
      ...(record.message === undefined ? {} : { message: record.message as string }),
      values: values as Record<string, string | number>,
    };
  } catch {
    return undefined;
  }
}

async function isRegularBundledExecutable(path: string): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function preflightFailure(
  code: Extract<MacOsCaptureHelperPreflightResult, { ok: false }>["code"],
  message: string,
): Extract<MacOsCaptureHelperPreflightResult, { ok: false }> {
  return { ok: false, code, message, setupCommand: SETUP_COMMAND };
}

async function waitForSocket(socketPath: string, child: CaptureHelperChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error("capture helper exited");
    try {
      const metadata = await lstat(socketPath);
      if (metadata.isSocket()) return;
    } catch {
      // The helper has not bound its socket yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("capture helper socket unavailable");
}

function captureFromSocket(input: {
  socketPath: string;
  token: string;
  region: MacOsCaptureRegion;
  timeoutMs: number;
}): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(input.socketPath);
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const timeout = setTimeout(() => socket.destroy(new Error("capture timeout")), input.timeoutMs);
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({ protocolVersion: 1, token: input.token, ...input.region })}\n`,
      );
    });
    socket.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAXIMUM_HEADER_BYTES + MAXIMUM_RESPONSE_BYTES) {
        socket.destroy(new Error("capture response too large"));
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("end", () => {
      clearTimeout(timeout);
      try {
        resolve(parseResponse(Buffer.concat(chunks), input.region));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function parseResponse(response: Buffer, region: MacOsCaptureRegion): Uint8Array | undefined {
  const newline = response.indexOf(0x0a);
  if (newline < 1 || newline > MAXIMUM_HEADER_BYTES) throw new Error("invalid capture header");
  const header = JSON.parse(response.subarray(0, newline).toString("utf8")) as Record<
    string,
    unknown
  >;
  if (header.ok !== true) return undefined;
  if (
    !Number.isInteger(header.byteLength) ||
    (header.byteLength as number) < 1 ||
    (header.byteLength as number) > MAXIMUM_RESPONSE_BYTES ||
    header.width !== region.width ||
    header.height !== region.height
  ) {
    throw new Error("invalid capture header");
  }
  const byteLength = header.byteLength as number;
  const png = response.subarray(newline + 1);
  if (png.length !== byteLength) throw new Error("invalid capture length");
  return Uint8Array.from(png);
}

function validRegion(region: MacOsCaptureRegion): boolean {
  return (
    Number.isInteger(region.x) &&
    Number.isInteger(region.y) &&
    Number.isInteger(region.width) &&
    Number.isInteger(region.height) &&
    Math.abs(region.x) <= 1_000_000 &&
    Math.abs(region.y) <= 1_000_000 &&
    region.width > 0 &&
    region.width <= 8_192 &&
    region.height > 0 &&
    region.height <= 8_192
  );
}

async function stopChild(child: CaptureHelperChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  const exited = new Promise<boolean>((resolve) => {
    child.once("exit", () => resolve(true));
    child.once("error", () => resolve(true));
  });
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    exited,
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ]);
  if (!stopped && child.exitCode === null) child.kill("SIGKILL");
}

async function cleanup(bootstrapPath: string, socketDirectory: string): Promise<void> {
  await Promise.all([
    rm(bootstrapPath, { force: true }),
    rm(socketDirectory, { recursive: true, force: true }),
  ]);
}

function runCommand(
  command: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { encoding: "utf8", maxBuffer: 64_000, timeout: 10_000 },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : 1,
          stdout,
          stderr,
        });
      },
    );
  });
}
