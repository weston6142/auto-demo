import { describe, expect, it } from "vitest";
import { createUnsupportedCaptureAdapter } from "./index.js";

describe("createUnsupportedCaptureAdapter", () => {
  it("fails clearly when capture is not implemented", async () => {
    const adapter = createUnsupportedCaptureAdapter("browser");
    const result = await adapter.start({
      projectName: "Checkout flow demo",
      source: { kind: "browser", url: "https://example.com" },
    });

    expect(result).toEqual({
      ok: false,
      code: "capture_not_implemented",
      message: "Browser capture is not implemented yet.",
    });
  });
});
