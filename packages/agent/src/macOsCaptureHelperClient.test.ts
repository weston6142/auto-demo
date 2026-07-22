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
  it("preflights signature, protocol, and permission without exposing child output", async () => {
    const fixture = await helperFixture();
    const commands: Array<{ command: string; args: string[] }> = [];
    const result = await preflightMacOsCaptureHelper({
      ...fixture.dependencies,
      async runCommand(command, args) {
        commands.push({ command, args: [...args] });
        if (command === "codesign") return { exitCode: 0, stdout: "", stderr: "" };
        if (args[0] === "--version-json") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              ok: true,
              protocolVersion: 1,
              bundleIdentifier: "com.autodemo.capture-helper",
            }),
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
      },
    });

    expect(result).toEqual({
      ok: true,
      installPath: fixture.installPath,
      protocolVersion: 1,
    });
    expect(commands.map((command) => command.args[0])).toEqual([
      "--verify",
      "--version-json",
      "--preflight-json",
    ]);
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

  it("uses a private bootstrap and authenticated short socket without putting the token in args", async () => {
    const fixture = await helperFixture();
    const png = Buffer.from([137, 80, 78, 71]);
    let bootstrapPath = "";
    let spawnArgs: string[] = [];
    let observedToken = "";
    const child = new FakeChildProcess();
    const client = await createMacOsCaptureHelperClient({
      sessionDirectory: fixture.sessionDirectory,
      installPath: fixture.installPath,
      dependencies: {
        ...fixture.dependencies,
        launch(_executable, args) {
          spawnArgs = [...args];
          bootstrapPath = args[1]!;
          void startProtocolServer(bootstrapPath, png, child, (token) => {
            observedToken = token;
          });
          return child;
        },
      },
    });

    expect(await client.capture({ x: 40, y: 120, width: 320, height: 240 })).toEqual(
      Uint8Array.from(png),
    );
    const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8")) as {
      token: string;
      socketPath: string;
    };
    expect(bootstrap.token).toMatch(/^[a-f0-9]{64}$/u);
    expect(observedToken).toBe(bootstrap.token);
    expect(spawnArgs.join(" ")).not.toContain(bootstrap.token);
    expect((await stat(bootstrapPath)).mode & 0o777).toBe(0o600);
    expect((await stat(join(bootstrap.socketPath, ".."))).mode & 0o777).toBe(0o700);
    expect(bootstrap.socketPath.length).toBeLessThan(104);

    await client.close();
    await client.close();
    expect(child.killSignals).toEqual(["SIGTERM"]);
    await expect(stat(bootstrapPath)).rejects.toThrow();
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
          void startMalformedServer(args[1]!, child);
          return child;
        },
      },
    });

    expect(await client.capture({ x: 0, y: 0, width: 320, height: 240 })).toBeUndefined();
    await client.close();
  });
});

async function helperFixture(options: { createExecutable?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "capture-helper-client-"));
  tempDirectories.push(root);
  const homeDirectory = join(root, "home");
  const installPath = join(homeDirectory, "Applications/Auto Demo Capture.app");
  const executable = join(installPath, "Contents/MacOS/AutoDemoCaptureHelper");
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
  return { dependencies, installPath, sessionDirectory };
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

async function startProtocolServer(
  bootstrapPath: string,
  png: Buffer,
  child: FakeChildProcess,
  observeToken: (token: string) => void,
) {
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

async function startMalformedServer(bootstrapPath: string, child: FakeChildProcess) {
  const bootstrap = JSON.parse(await readFile(bootstrapPath, "utf8")) as { socketPath: string };
  const server = createServer((socket) => socket.end('{"ok":true,"byteLength":4,"width":1}\nno'));
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
