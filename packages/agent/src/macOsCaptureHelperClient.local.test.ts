import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { expect, it } from "vitest";
import {
  createMacOsCaptureHelperClient,
  preflightMacOsCaptureHelper,
} from "./macOsCaptureHelperClient.js";

it.runIf(process.platform === "darwin" && process.env.AUTODEMO_REAL_CAPTURE_HELPER === "1")(
  "captures and cleans up through the real signed helper",
  async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-real-capture-"));
    await chmod(sessionDirectory, 0o700);
    let client: Awaited<ReturnType<typeof createMacOsCaptureHelperClient>> | undefined;
    try {
      const preflight = await preflightMacOsCaptureHelper();
      expect(preflight).toEqual({
        ok: true,
        installPath: join(homedir(), "Applications", "Auto Demo Capture.app"),
        protocolVersion: 1,
      });
      if (!preflight.ok) return;
      client = await createMacOsCaptureHelperClient({
        sessionDirectory,
        installPath: preflight.installPath,
      });
      const bytes = await client.capture({ x: 0, y: 0, width: 32, height: 32 });
      expect(bytes).toBeDefined();
      const image = PNG.sync.read(Buffer.from(bytes!));
      expect({ width: image.width, height: image.height }).toEqual({ width: 32, height: 32 });
      await client.close();
      client = undefined;
      expect(await readdir(sessionDirectory)).toEqual(["native-capture-diagnostics.jsonl"]);
      expect(
        await readFile(join(sessionDirectory, "native-capture-diagnostics.jsonl"), "utf8"),
      ).toContain('"event":"capture_succeeded"');
      expect(await runningCaptureProcesses()).toEqual([]);
    } finally {
      await client?.close();
      await rm(sessionDirectory, { recursive: true, force: true });
    }
  },
  5_000,
);

async function runningCaptureProcesses(): Promise<string[]> {
  const executableDirectory = join(
    homedir(),
    "Applications",
    "Auto Demo Capture.app",
    "Contents",
    "MacOS",
  );
  const results = await Promise.all(
    ["AutoDemoCaptureHelper", "AutoDemoCaptureSupervisor"].map((name) =>
      matchingProcesses(`^${join(executableDirectory, name)}( |$)`),
    ),
  );
  return results.flat();
}

function matchingProcesses(pattern: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile("pgrep", ["-f", pattern], (error, stdout) => {
      if (error !== null && error.code !== 1) {
        reject(error);
        return;
      }
      resolve(stdout.trim().split("\n").filter(Boolean));
    });
  });
}
