import { chmod, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  attachDiscoverPageDiagnostics,
  createDiscoverHostDiagnosticRecorder,
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
    const page = new FakeDiagnosticPage();
    const attached = attachDiscoverPageDiagnostics({
      page,
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
    page.emitResponse(
      response({
        frame: page.main,
        resourceType: "script",
        status: 200,
        url: "https://www.example.test/private-script?token=subresource-secret",
      }),
    );
    page.emitResponse(
      response({
        frame: page.main,
        resourceType: "document",
        status: 302,
        url: "https://www.example.test/private-result?token=same-origin-secret",
      }),
    );
    page.emitResponse(
      response({
        frame: page.main,
        resourceType: "document",
        status: 403,
        url: "https://challenge.example.net/private-block?token=other-origin-secret",
      }),
    );
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
        status: 302,
        originRelation: "same-origin",
      }),
      expect.objectContaining({
        schemaVersion: 1,
        sequence: 3,
        event: "main_document_response",
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
      /private-|url-secret|subresource-secret|same-origin-secret|other-origin-secret|script/u,
    );
  });

  it("does not let page diagnostic failures alter discovery behavior", async () => {
    const sessionDirectory = await mkdtemp(join(tmpdir(), "auto-demo-discover-diagnostics-"));
    tempDirectories.push(sessionDirectory);
    const recorder = await createDiscoverHostDiagnosticRecorder(sessionDirectory);
    const attachFailure = new ThrowingDiagnosticPage("attach");

    const attached = attachDiscoverPageDiagnostics({
      page: attachFailure,
      startUrl: "https://example.test",
      recorder,
    });
    expect(() => attachFailure.emitResponse()).not.toThrow();
    await expect(attached.close()).resolves.toBeUndefined();

    const listenerFailure = new ThrowingDiagnosticPage("listener");
    const listening = attachDiscoverPageDiagnostics({
      page: listenerFailure,
      startUrl: "https://example.test",
      recorder,
    });
    expect(() => listenerFailure.emitResponse()).not.toThrow();
    await expect(listening.close()).resolves.toBeUndefined();
    await recorder.close();
  });
});

type DiagnosticResponse = {
  request(): { resourceType(): string };
  frame(): object;
  status(): number;
  url(): string;
};

class FakeDiagnosticPage {
  readonly main = {};
  private readonly listeners = new Set<(response: DiagnosticResponse) => void>();

  mainFrame() {
    return this.main;
  }

  onResponse(listener: (response: DiagnosticResponse) => void) {
    this.listeners.add(listener);
  }

  offResponse(listener: (response: DiagnosticResponse) => void) {
    this.listeners.delete(listener);
  }

  emitResponse(value: DiagnosticResponse) {
    for (const listener of this.listeners) listener(value);
  }
}

class ThrowingDiagnosticPage {
  private listener: ((response: DiagnosticResponse) => void) | undefined;

  constructor(private readonly failure: "attach" | "listener") {}

  mainFrame() {
    return {};
  }

  onResponse(listener: (response: DiagnosticResponse) => void) {
    if (this.failure === "attach") throw new Error("diagnostic-attach-secret");
    this.listener = listener;
  }

  offResponse() {
    throw new Error("diagnostic-detach-secret");
  }

  emitResponse() {
    this.listener?.({
      request() {
        throw new Error("diagnostic-listener-secret");
      },
      frame: () => ({}),
      status: () => 403,
      url: () => "https://example.test/private",
    });
  }
}

function response(input: {
  frame: object;
  resourceType: string;
  status: number;
  url: string;
}): DiagnosticResponse {
  return {
    request: () => ({ resourceType: () => input.resourceType }),
    frame: () => input.frame,
    status: () => input.status,
    url: () => input.url,
  };
}
