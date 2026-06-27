import { describe, expect, it } from "vitest";
import { runCli } from "./index.js";

describe("runCli", () => {
  it("prints help with a zero exit code", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: autodemo <command>");
    expect(result.stderr).toBe("");
  });

  it("fails clearly for planned but unimplemented commands", () => {
    const result = runCli(["capture"]);

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "autodemo capture is not implemented yet.\n",
    });
  });

  it("prints help and fails for unknown commands", () => {
    const result = runCli(["wat"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("Usage: autodemo <command>");
    expect(result.stderr).toBe("Unknown command: wat\n");
  });
});
