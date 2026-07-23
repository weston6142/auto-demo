import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDiscoverHostDiagnosticRecorder,
  createDiscoverPageDiagnostics,
} from "./discoverHostDiagnostics.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("discover host diagnostics", () => {
  it("retains only bounded profile and main-document response evidence", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-discover-diagnostics-"));
    tempDirectories.push(sessionDirectory);
    await chmod(sessionDirectory, 0o700);
    const recorder = await createDiscoverHostDiagnosticRecorder(sessionDirectory);
    const attached = createDiscoverPageDiagnostics({
      startUrl: "https://www.example.test/private-start?token=url-secret",
      recorder,
    });

    const profileId = `sha256:${"a".repeat(64)}`;
    await recorder.record({
      event: "runtime_started",
      profileId,
      channel: "chrome",
      headless: false,
      viewport: { width: 1280, height: 720 },
    });
    attached.onMainDocumentResponse({
      ordinal: 1,
      profileId,
      status: 99,
      url: "https://www.example.test/private-invalid?token=invalid-secret",
    });
    attached.onMainDocumentResponse({
      ordinal: 1,
      profileId,
      status: 302,
      url: "https://www.example.test/private-result?token=same-origin-secret",
    });
    attached.onMainDocumentResponse({
      ordinal: 2,
      profileId: `sha256:${"b".repeat(64)}`,
      status: 403,
      url: "https://challenge.example.net/private-block?token=other-origin-secret",
    });
    await attached.close();
    await recorder.close();

    const diagnosticPath = join(sessionDirectory, "discover-host-diagnostics.jsonl");
    expect((await stat(diagnosticPath)).mode & 0o777).toBe(0o600);
    const diagnosticText = await readFile(diagnosticPath, "utf8");
    const diagnostics = diagnosticText
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        schemaVersion: 1,
        sequence: 1,
        event: "runtime_started",
        profileId,
        channel: "chrome",
        headless: false,
        viewport: { width: 1280, height: 720 },
      }),
      expect.objectContaining({
        schemaVersion: 1,
        sequence: 2,
        event: "main_document_response",
        ordinal: 1,
        profileId,
        status: 302,
        originRelation: "same-origin",
      }),
      expect.objectContaining({
        schemaVersion: 1,
        sequence: 3,
        event: "main_document_response",
        ordinal: 2,
        profileId: `sha256:${"b".repeat(64)}`,
        status: 403,
        originRelation: "other-origin",
      }),
    ]);
    expect(
      diagnostics.every(
        (record, index) =>
          record.sequence === index + 1 &&
          typeof record.sessionElapsedMs === "number" &&
          record.sessionElapsedMs >= 0 &&
          record.sessionElapsedMs <= 86_400_000,
      ),
    ).toBe(true);
    expect(diagnosticText).not.toMatch(
      /private-|url-secret|invalid-secret|same-origin-secret|other-origin-secret/u,
    );
  });

  it("does not let page diagnostic failures alter discovery behavior", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-discover-diagnostics-"));
    tempDirectories.push(sessionDirectory);
    const recorder = {
      async record() {
        throw new Error("diagnostic-write-secret");
      },
      async close() {},
    };
    const attached = createDiscoverPageDiagnostics({
      startUrl: "https://example.test",
      recorder,
    });
    expect(() =>
      attached.onMainDocumentResponse({
        ordinal: 1,
        profileId: `sha256:${"a".repeat(64)}`,
        status: 403,
        url: "https://example.test/private?token=listener-secret",
      }),
    ).not.toThrow();
    expect(() =>
      attached.onMainDocumentResponse({
        ordinal: 1,
        profileId: `sha256:${"a".repeat(64)}`,
        status: 403,
        url: "not a url containing malformed-secret",
      }),
    ).not.toThrow();
    await expect(attached.close()).resolves.toBeUndefined();

    const unavailableRecorder = await createDiscoverHostDiagnosticRecorder(sessionDirectory);
    await expect(unavailableRecorder.record({ event: "runtime_stopped" })).resolves.toBeUndefined();
    await expect(unavailableRecorder.close()).resolves.toBeUndefined();
  });
});
