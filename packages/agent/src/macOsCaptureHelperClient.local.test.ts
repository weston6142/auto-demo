import { chmod, mkdtemp, readdir, rm } from "node:fs/promises";
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
      expect(await readdir(sessionDirectory)).toEqual([]);
    } finally {
      await client?.close();
      await rm(sessionDirectory, { recursive: true, force: true });
    }
  },
);
