import { EventEmitter } from "node:events";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createMacOsCaptureHelperClient,
  preflightMacOsCaptureHelper,
  type CaptureHelperChildProcess,
  type MacOsCaptureHelperDependencies,
} from "./macOsCaptureHelperClient.js";

const tempDirectories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("macOS capture helper client", () => {
  it("probes the signed app through its bundled supervisor", async () => {
    const fixture = await helperFixture();
    const commands: Array<{ command: string; args: string[] }> = [];
    const result = await preflightMacOsCaptureHelper({
      ...fixture.dependencies,
      async runCommand(command, args) {
        commands.push({ command, args: [...args] });
        return await fixture.respondToCommand(command, args);
      },
    });

    expect(result).toEqual({
      ok: true,
      installPath: fixture.installPath,
      protocolVersion: 1,
    });
    expect(commands.filter(({ args }) => args[0] === "--launch-request")).toHaveLength(2);
    expect(
      commands.some(({ command }) => command.endsWith("/Contents/MacOS/AutoDemoCaptureHelper")),
    ).toBe(false);
  });

  it("returns exact setup guidance when the helper is missing", async () => {
    const fixture = await helperFixture({ createExecutable: false });

    expect(await preflightMacOsCaptureHelper(fixture.dependencies)).toEqual({
      ok: false,
      code: "capture_helper_not_installed",
      message: "Auto Demo Capture is not installed.",
      setupCommand: "npm run autodemo -- setup capture-helper --json",
    });
  });

  it("preserves a bounded unavailable permission-probe failure", async () => {
    const fixture = await helperFixture();

    expect(
      await preflightMacOsCaptureHelper({
        ...fixture.dependencies,
        async runCommand(command, args) {
          if (command === "codesign") return { exitCode: 0, stdout: "", stderr: "" };
          const request = JSON.parse(await readFile(args[1]!, "utf8")) as {
            mode: string;
            responsePath: string;
          };
          const response =
            request.mode === "version"
              ? {
                  ok: true,
                  code: "capture_helper_version",
                  values: {
                    protocolVersion: 1,
                    bundleIdentifier: "com.autodemo.capture-helper",
                  },
                }
              : {
                  ok: false,
                  code: "capture_helper_unavailable",
                  message: "Auto Demo Capture could not check permission.",
                };
          await writeFile(request.responsePath, `${JSON.stringify(response)}\n`, {
            flag: "wx",
            mode: 0o600,
          });
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    ).toEqual({
      ok: false,
      code: "capture_helper_unavailable",
      message: "Auto Demo Capture could not complete its permission check.",
      setupCommand: "npm run autodemo -- setup capture-helper --json",
    });
  });

  it("uses a private bootstrap and authenticated short socket without putting the token in args", async () => {
    const fixture = await helperFixture();
    const png = Buffer.from([137, 80, 78, 71]);
    let launchRequestPath = "";
    let spawnArgs: string[] = [];
    let observedToken = "";
    const child = new FakeChildProcess();
    const client = await createMacOsCaptureHelperClient({
      sessionDirectory: fixture.sessionDirectory,
      installPath: fixture.installPath,
      dependencies: {
        ...fixture.dependencies,
        launch(executable, args) {
          expect(executable).toMatch(/AutoDemoCaptureSupervisor$/u);
          spawnArgs = [...args];
          launchRequestPath = args[1]!;
          void startProtocolServerFromLaunchRequest(launchRequestPath, png, child, (token) => {
            observedToken = token;
          });
          return child;
        },
      },
    });

    expect(await client.capture({ x: 40, y: 120, width: 320, height: 240 })).toEqual(
      Uint8Array.from(png),
    );
    expect(spawnArgs).toEqual(["--launch-request", expect.any(String)]);
    const launchRequest = JSON.parse(await readFile(launchRequestPath, "utf8")) as {
      bootstrapPath: string;
    };
    const bootstrap = JSON.parse(await readFile(launchRequest.bootstrapPath, "utf8")) as {
      token: string;
      socketPath: string;
      idleTimeoutMs: number;
    };
    expect(bootstrap.token).toMatch(/^[a-f0-9]{64}$/u);
    expect(observedToken).toBe(bootstrap.token);
    expect(spawnArgs.join(" ")).not.toContain(bootstrap.token);
    expect((await stat(launchRequestPath)).mode & 0o777).toBe(0o600);
    expect((await stat(launchRequest.bootstrapPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(bootstrap.socketPath, ".."))).mode & 0o777).toBe(0o700);
    expect(bootstrap.socketPath.length).toBeLessThan(104);
    expect(bootstrap.idleTimeoutMs).toBe(300_000);

    await client.close();
    await client.close();
    expect(child.killSignals).toEqual(["SIGTERM"]);
    await expect(stat(launchRequestPath)).rejects.toThrow();
    await expect(stat(launchRequest.bootstrapPath)).rejects.toThrow();
  });

  it("fails closed on malformed or incorrectly sized helper responses", async () => {
    const fixture = await helperFixture();
    const child = new FakeChildProcess();
    const client = await createMacOsCaptureHelperClient({
      sessionDirectory: fixture.sessionDirectory,
      installPath: fixture.installPath,
      dependencies: {
        ...fixture.dependencies,
        launch(_executable, args) {
          void startMalformedServerFromLaunchRequest(args[1]!, child);
          return child;
        },
      },
    });

    expect(await client.capture({ x: 0, y: 0, width: 320, height: 240 })).toBeUndefined();
    await client.close();
  });

  it("persists private bounded diagnostics for helper capture failures", async () => {
    const fixture = await helperFixture();
    const child = new FakeChildProcess();
    let observedToken = "";
    const client = await createMacOsCaptureHelperClient({
      sessionDirectory: fixture.sessionDirectory,
      installPath: fixture.installPath,
      dependencies: {
        ...fixture.dependencies,
        launch(_executable, args) {
          void startFailureServerFromLaunchRequest(args[1]!, child, (token) => {
            observedToken = token;
          });
          return child;
        },
      },
    });

    expect(await client.capture({ x: 40, y: 120, width: 320, height: 240 })).toBeUndefined();
    await client.close();

    const diagnosticPath = join(fixture.sessionDirectory, "native-capture-diagnostics.jsonl");
    expect((await stat(diagnosticPath)).mode & 0o777).toBe(0o600);
    const diagnosticText = await readFile(diagnosticPath, "utf8");
    const diagnostics = diagnosticText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          schemaVersion: 1,
          event: "capture_failed",
          attempt: 1,
          stage: "screenshot_capture",
          code: "native_window_capture_unavailable",
          systemErrorDomain: "SCStreamErrorDomain",
          systemErrorCode: -3812,
          region: { x: 40, y: 120, width: 320, height: 240 },
        }),
      ]),
    );
    expect(diagnostics.every((event) => typeof event.sessionElapsedMs === "number")).toBe(true);
    expect(diagnosticText).not.toContain(observedToken);
    expect(diagnosticText).not.toContain(fixture.sessionDirectory);
  });

  it("rejects a supervisor spawn error without an unhandled child-process error", async () => {
    const fixture = await helperFixture();
    const child = new FakeChildProcess();

    await expect(
      createMacOsCaptureHelperClient({
        sessionDirectory: fixture.sessionDirectory,
        installPath: fixture.installPath,
        dependencies: {
          ...fixture.dependencies,
          launch() {
            queueMicrotask(() => child.emit("error", new Error("spawn failed")));
            return child;
          },
        },
      }),
    ).rejects.toThrow("capture helper");
  });

  it("rejects close when forced supervisor exit cannot be confirmed", async () => {
    const fixture = await helperFixture();
    const png = Buffer.from([137, 80, 78, 71]);
    const child = new NonExitingChildProcess();
    const client = await createMacOsCaptureHelperClient({
      sessionDirectory: fixture.sessionDirectory,
      installPath: fixture.installPath,
      dependencies: {
        ...fixture.dependencies,
        terminationTimeoutMs: 5,
        forceTerminationTimeoutMs: 5,
        launch(_executable, args) {
          void startProtocolServerFromLaunchRequest(args[1]!, png, child, () => undefined);
          return child;
        },
      },
    });

    await expect(client.close()).rejects.toThrow("did not exit");
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("does not treat a child error during termination as confirmed exit", async () => {
    const fixture = await helperFixture();
    const png = Buffer.from([137, 80, 78, 71]);
    const child = new ErroringKillChildProcess();
    const client = await createMacOsCaptureHelperClient({
      sessionDirectory: fixture.sessionDirectory,
      installPath: fixture.installPath,
      dependencies: {
        ...fixture.dependencies,
        terminationTimeoutMs: 5,
        forceTerminationTimeoutMs: 5,
        launch(_executable, args) {
          void startProtocolServerFromLaunchRequest(args[1]!, png, child, () => undefined);
          return child;
        },
      },
    });

    await expect(client.close()).rejects.toThrow("did not exit");
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("closes diagnostics while preserving a cleanup failure", async () => {
    const fixture = await helperFixture();
    const png = Buffer.from([137, 80, 78, 71]);
    const child = new FakeChildProcess();
    const events: unknown[] = [];
    let diagnosticCloseCount = 0;
    const client = await createMacOsCaptureHelperClient({
      sessionDirectory: fixture.sessionDirectory,
      installPath: fixture.installPath,
      dependencies: {
        ...fixture.dependencies,
        async createDiagnosticRecorder() {
          return {
            async record(event) {
              events.push(event);
            },
            async close() {
              diagnosticCloseCount += 1;
            },
          };
        },
        async cleanupPaths() {
          throw new Error("cleanup failed");
        },
        launch(_executable, args) {
          void startProtocolServerFromLaunchRequest(args[1]!, png, child, () => undefined);
          return child;
        },
      },
    });

    await expect(client.close()).rejects.toThrow("cleanup failed");
    expect(diagnosticCloseCount).toBe(1);
    expect(events).toContainEqual({ event: "helper_stopped" });
  });
});

async function helperFixture(
  options: { createExecutable?: boolean; createSupervisor?: boolean } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "capture-helper-client-"));
  tempDirectories.push(root);
  const homeDirectory = join(root, "home");
  const installPath = join(homeDirectory, "Applications/Auto Demo Capture.app");
  const executable = join(installPath, "Contents/MacOS/AutoDemoCaptureHelper");
  const supervisor = join(installPath, "Contents/MacOS/AutoDemoCaptureSupervisor");
  const sessionDirectory = join(root, "session");
  await import("node:fs/promises").then(({ mkdir }) =>
    Promise.all([
      mkdir(join(installPath, "Contents/MacOS"), { recursive: true }),
      mkdir(sessionDirectory, { recursive: true }),
    ]),
  );
  if (options.createExecutable !== false) {
    await writeFile(executable, "fixture\n");
    await chmod(executable, 0o755);
  }
  if (options.createSupervisor !== false) {
    await writeFile(supervisor, "fixture\n");
    await chmod(supervisor, 0o755);
  }
  const dependencies: MacOsCaptureHelperDependencies = {
    platform: "darwin",
    homeDirectory,
    temporaryDirectory: root,
    async runCommand() {
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    launch() {
      throw new Error("launch not configured");
    },
  };
  async function respondToCommand(command: string, args: string[]) {
    if (command === "codesign") return { exitCode: 0, stdout: "", stderr: "" };
    if (command !== supervisor || args[0] !== "--launch-request") {
      return { exitCode: 1, stdout: "", stderr: "" };
    }
    const request = JSON.parse(await readFile(args[1]!, "utf8")) as {
      mode: string;
      responsePath: string;
    };
    const result =
      request.mode === "version"
        ? {
            ok: true,
            code: "capture_helper_version",
            values: {
              protocolVersion: 1,
              bundleIdentifier: "com.autodemo.capture-helper",
            },
          }
        : { ok: true, code: "capture_helper_permission_granted", values: {} };
    await writeFile(request.responsePath, `${JSON.stringify(result)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  return { dependencies, installPath, sessionDirectory, respondToCommand };
}

class FakeChildProcess extends EventEmitter implements CaptureHelperChildProcess {
  exitCode: number | null = null;
  killSignals: NodeJS.Signals[] = [];
  onKill: (() => void) | undefined;

  kill(signal: NodeJS.Signals): boolean {
    if (this.exitCode !== null) return false;
    this.killSignals.push(signal);
    this.exitCode = 0;
    this.onKill?.();
    this.emit("exit", 0, null);
    return true;
  }
}

class NonExitingChildProcess extends EventEmitter implements CaptureHelperChildProcess {
  exitCode: number | null = null;
  killSignals: NodeJS.Signals[] = [];
  onKill: (() => void) | undefined;

  kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    this.onKill?.();
    return true;
  }
}

class ErroringKillChildProcess extends NonExitingChildProcess {
  override kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    this.onKill?.();
    queueMicrotask(() => this.emit("error", new Error("signal failed")));
    return false;
  }
}

async function startProtocolServerFromLaunchRequest(
  launchRequestPath: string,
  png: Buffer,
  child: { onKill: (() => void) | undefined },
  observeToken: (token: string) => void,
) {
  const launchRequest = JSON.parse(await readFile(launchRequestPath, "utf8")) as {
    bootstrapPath: string;
  };
  const bootstrapPath = launchRequest.bootstrapPath;
  const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8")) as {
    socketPath: string;
    token: string;
  };
  const server = createServer((socket) => {
    let request = "";
    socket.on("data", (chunk) => {
      request += chunk.toString("utf8");
      if (!request.includes("\n")) return;
      const parsed = JSON.parse(request.trim()) as { token: string; width: number; height: number };
      observeToken(parsed.token);
      socket.end(
        Buffer.concat([
          Buffer.from(
            `${JSON.stringify({
              ok: true,
              byteLength: png.length,
              width: parsed.width,
              height: parsed.height,
            })}\n`,
          ),
          png,
        ]),
      );
    });
  });
  servers.push(server);
  child.onKill = () => server.close();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(bootstrap.socketPath, resolve);
  });
}

async function startMalformedServerFromLaunchRequest(
  launchRequestPath: string,
  child: FakeChildProcess,
) {
  const launchRequest = JSON.parse(await readFile(launchRequestPath, "utf8")) as {
    bootstrapPath: string;
  };
  const bootstrapPath = launchRequest.bootstrapPath;
  const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8")) as { socketPath: string };
  const server = createServer((socket) => socket.end('{"ok":true,"byteLength":4,"width":1}\nno'));
  servers.push(server);
  child.onKill = () => server.close();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(bootstrap.socketPath, resolve);
  });
}

async function startFailureServerFromLaunchRequest(
  launchRequestPath: string,
  child: FakeChildProcess,
  observeToken: (token: string) => void,
) {
  const launchRequest = JSON.parse(await readFile(launchRequestPath, "utf8")) as {
    bootstrapPath: string;
  };
  const bootstrap = JSON.parse(await readFile(launchRequest.bootstrapPath, "utf8")) as {
    socketPath: string;
  };
  const server = createServer((socket) => {
    let request = "";
    socket.on("data", (chunk) => {
      request += chunk.toString("utf8");
      if (!request.includes("\n")) return;
      const parsed = JSON.parse(request.trim()) as { token: string };
      observeToken(parsed.token);
      socket.end(
        `${JSON.stringify({
          ok: false,
          code: "native_window_capture_unavailable",
          message: "Native browser UI capture is unavailable.",
          diagnosticStage: "screenshot_capture",
          systemErrorDomain: "SCStreamErrorDomain",
          systemErrorCode: -3812,
        })}\n`,
      );
    });
  });
  servers.push(server);
  child.onKill = () => server.close();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(bootstrap.socketPath, resolve);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) return resolve();
    server.close(() => resolve());
  });
}
