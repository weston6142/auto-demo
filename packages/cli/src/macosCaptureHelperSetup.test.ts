import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseCodeSigningIdentities,
  runMacOsCaptureHelperSetup,
  type CaptureHelperSetupDependencies,
} from "./macosCaptureHelperSetup.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("macOS capture helper setup", () => {
  it("lists only Apple Development signing identities", () => {
    expect(
      parseCodeSigningIdentities(`
  1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Development: Local User (TEAM1)"
  2) BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB "Developer ID Application: Example Inc (TEAM2)"
  3) CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC "Apple Distribution: Local User (TEAM1)"
     3 valid identities found
`),
    ).toEqual([
      {
        fingerprint: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        label: "Apple Development: Local User (TEAM1)",
      },
    ]);
  });

  it("requires an explicit choice when multiple development identities exist", async () => {
    const fixture = await setupFixture({ identities: [identity("A"), identity("B")] });

    const result = await runMacOsCaptureHelperSetup(
      { adHoc: false, json: true },
      fixture.dependencies,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "signing_identity_required",
      choices: [{ fingerprint: "A".repeat(40) }, { fingerprint: "B".repeat(40) }],
    });
    expect(fixture.commands).not.toContainEqual(expect.objectContaining({ command: "swift" }));
  });

  it("builds, signs, installs, and preflights with the selected local identity", async () => {
    const fixture = await setupFixture({ identities: [identity("A"), identity("B")] });

    const result = await runMacOsCaptureHelperSetup(
      { adHoc: false, json: true, signingIdentity: "B".repeat(40) },
      fixture.dependencies,
    );

    expect(result).toEqual({
      ok: true,
      code: "capture_helper_ready",
      installPath: fixture.installPath,
      signature: "development",
    });
    expect(fixture.commands).toContainEqual(
      expect.objectContaining({
        command: "codesign",
        args: expect.arrayContaining(["--sign", "B".repeat(40)]),
      }),
    );
    expect(
      await readFile(join(fixture.installPath, "Contents/Resources/signature-kind"), "utf8"),
    ).toBe("development\n");
    expect(
      JSON.stringify(await readFile(join(fixture.installPath, "Contents/Resources/source-hash"))),
    ).not.toContain("Local User");
    await expect(
      stat(join(fixture.installPath, "Contents/MacOS/AutoDemoCaptureHelper")),
    ).resolves.toBeDefined();
    await expect(
      stat(join(fixture.installPath, "Contents/MacOS/AutoDemoCaptureSupervisor")),
    ).resolves.toBeDefined();
    expect(fixture.probes.map(({ mode }) => mode)).toEqual(["version", "permission-preflight"]);
  });

  it("supports explicit ad-hoc signing and returns a bounded permission requirement", async () => {
    const fixture = await setupFixture({ permissionGranted: false });

    const result = await runMacOsCaptureHelperSetup(
      { adHoc: true, json: true },
      fixture.dependencies,
    );

    expect(result).toEqual({
      ok: false,
      code: "capture_helper_permission_required",
      message: "Auto Demo Capture needs Screen Recording permission.",
    });
    expect(fixture.commands).toContainEqual(
      expect.objectContaining({
        command: "codesign",
        args: expect.arrayContaining(["--sign", "-"]),
      }),
    );
  });

  it("does not request permission when the supervised preflight is unavailable", async () => {
    const fixture = await setupFixture({ permissionUnavailable: true });

    const result = await runMacOsCaptureHelperSetup(
      { adHoc: true, json: true },
      fixture.dependencies,
    );

    expect(result).toEqual({
      ok: false,
      code: "capture_helper_unavailable",
      message: "Auto Demo Capture could not complete its permission check.",
    });
    expect(fixture.probes.map(({ mode }) => mode)).toEqual(["version", "permission-preflight"]);
  });

  it("does not rebuild an installed current helper", async () => {
    const fixture = await setupFixture({ identities: [identity("A")] });
    expect(
      await runMacOsCaptureHelperSetup(
        { adHoc: false, json: true, signingIdentity: "A".repeat(40) },
        fixture.dependencies,
      ),
    ).toMatchObject({ ok: true });
    fixture.commands.length = 0;

    expect(
      await runMacOsCaptureHelperSetup({ adHoc: false, json: true }, fixture.dependencies),
    ).toMatchObject({ ok: true, signature: "development" });
    expect(fixture.commands).not.toContainEqual(expect.objectContaining({ command: "swift" }));
  });

  it("fails closed away from macOS", async () => {
    const fixture = await setupFixture();

    expect(
      await runMacOsCaptureHelperSetup(
        { adHoc: false, json: true },
        { ...fixture.dependencies, platform: "linux" },
      ),
    ).toEqual({
      ok: false,
      code: "unsupported_platform",
      message: "Auto Demo Capture is supported only on macOS.",
    });
  });
});

type FixtureOptions = {
  identities?: Array<{ fingerprint: string; label: string }>;
  permissionGranted?: boolean;
  permissionUnavailable?: boolean;
};

async function setupFixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "capture-helper-setup-"));
  tempDirectories.push(root);
  const repositoryRoot = join(root, "repo");
  const homeDirectory = join(root, "home");
  const nativeRoot = join(repositoryRoot, "native/macos-capture-helper");
  await mkdir(join(nativeRoot, "Resources"), { recursive: true });
  await mkdir(homeDirectory, { recursive: true });
  await writeFile(join(nativeRoot, "Package.swift"), "// fixture\n");
  await writeFile(join(nativeRoot, "Resources/Info.plist"), "<plist><dict/></plist>\n");
  const commands: Array<{ command: string; args: string[] }> = [];
  const probes: Array<{ installPath: string; mode: string }> = [];
  const identities = options.identities ?? [];
  const permissionGranted = options.permissionGranted ?? true;
  const emptyProbeValues: Record<string, string | number> = {};

  const dependencies: CaptureHelperSetupDependencies = {
    platform: "darwin",
    repositoryRoot,
    homeDirectory,
    async runCommand(command, args) {
      commands.push({ command, args: [...args] });
      if (command === "security") {
        return {
          exitCode: 0,
          stdout: identities
            .map((item, index) => `${index + 1}) ${item.fingerprint} "${item.label}"`)
            .join("\n"),
        };
      }
      if (command === "swift") {
        const scratchPath = args[args.indexOf("--scratch-path") + 1]!;
        await mkdir(join(scratchPath, "release"), { recursive: true });
        for (const name of ["AutoDemoCaptureHelper", "AutoDemoCaptureSupervisor"]) {
          const executable = join(scratchPath, "release", name);
          await writeFile(executable, `${name} executable\n`);
          await chmod(executable, 0o755);
        }
        return { exitCode: 0, stdout: "" };
      }
      if (command === "codesign") return { exitCode: 0, stdout: "" };
      return { exitCode: 1, stdout: "" };
    },
    async probeHelper(input) {
      probes.push({ installPath: input.installPath, mode: input.mode });
      if (input.mode === "version") {
        return {
          ok: true,
          code: "capture_helper_version",
          values: {
            protocolVersion: 1,
            bundleIdentifier: "com.autodemo.capture-helper",
          },
        };
      }
      if (options.permissionUnavailable === true) return undefined;
      return permissionGranted
        ? {
            ok: true,
            code: "capture_helper_permission_granted",
            values: emptyProbeValues,
          }
        : {
            ok: false,
            code: "capture_helper_permission_required",
            message: "Auto Demo Capture needs Screen Recording permission.",
            values: emptyProbeValues,
          };
    },
  };
  return {
    commands,
    dependencies,
    installPath: join(homeDirectory, "Applications/Auto Demo Capture.app"),
    probes,
  };
}

function identity(character: string) {
  return {
    fingerprint: character.repeat(40),
    label: `Apple Development: Local User ${character} (TEAM1)`,
  };
}
