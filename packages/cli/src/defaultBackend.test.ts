import type { BrowserCaptureOptions } from "@auto-demo/capture";
import { describe, expect, it, vi } from "vitest";

const factoryCalls: string[] = [];

vi.mock("@auto-demo/capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@auto-demo/capture")>();
  return {
    ...actual,
    createUnsupportedBrowserCaptureAdapter: () => {
      factoryCalls.push("unsupported");
      return actual.createUnsupportedBrowserCaptureAdapter();
    },
    createPlaywrightBrowserCaptureAdapter: () => {
      factoryCalls.push("playwright");
      return {
        kind: "browser" as const,
        async start(options: BrowserCaptureOptions) {
          return {
            ok: false as const,
            code: "capture_setup_failed" as const,
            message: "mock playwright setup failed",
            outputDir: options.outputDir,
            manifestPath: `${options.outputDir}/capture.manifest.json`,
          };
        },
      };
    },
  };
});

describe("default capture backend", () => {
  it("uses the Playwright browser capture adapter", async () => {
    factoryCalls.length = 0;
    const { runCliAsync } = await import("./index.js");

    const result = await runCliAsync([
      "capture",
      "--url",
      "https://example.com",
      "--out",
      "demo-capture",
    ]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "mock playwright setup failed\n",
    });
    expect(factoryCalls).toEqual(["playwright"]);
  });
});
