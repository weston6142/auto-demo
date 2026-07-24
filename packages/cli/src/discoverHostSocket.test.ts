import { chmod, lstat, mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  allocateDiscoverHostSocket,
  isTrustedDiscoverHostSocketPath,
} from "./discoverHostSocket.js";

const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function bindSocket(socketPath: string): Promise<void> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => resolve());
  });
  await chmod(socketPath, 0o600);
}

describe("allocateDiscoverHostSocket", () => {
  it("allocates a private owner-only socket directory outside the session path", async () => {
    const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
    directories.push(root);

    const allocation = await allocateDiscoverHostSocket(root);
    directories.push(allocation.socketDirectory);

    expect(allocation.socketPath).toBe(join(allocation.socketDirectory, "host.sock"));
    expect(allocation.socketDirectory.startsWith(root)).toBe(true);
    const metadata = await lstat(allocation.socketDirectory);
    expect(metadata.isDirectory()).toBe(true);
    expect(metadata.mode & 0o777).toBe(0o700);
    expect(allocation.socketPath.length).toBeLessThan(104);
  });

  it("cleanup removes the socket directory even after a socket was bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
    directories.push(root);

    const allocation = await allocateDiscoverHostSocket(root);
    await bindSocket(allocation.socketPath);
    await allocation.cleanup();

    await expect(lstat(allocation.socketDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["a-very-long-ascii-segment".repeat(5), "é".repeat(55)])(
    "rejects and removes allocations whose UTF-8 socket path is too long",
    async (segment) => {
      const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
      directories.push(root);
      const longRoot = join(root, segment);
      await mkdir(longRoot, { recursive: true });

      await expect(allocateDiscoverHostSocket(longRoot)).rejects.toThrow(
        "Discover host socket path exceeds the supported byte limit.",
      );
      await expect(readdir(longRoot)).resolves.toEqual([]);
    },
  );
});

describe("isTrustedDiscoverHostSocketPath", () => {
  it("accepts a bound socket inside an owner-only allocated directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
    directories.push(root);
    const allocation = await allocateDiscoverHostSocket(root);
    await bindSocket(allocation.socketPath);

    await expect(isTrustedDiscoverHostSocketPath(allocation.socketPath)).resolves.toBe(true);
  });

  it("rejects non-strings, missing paths, and unexpected socket file names", async () => {
    const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
    directories.push(root);
    const allocation = await allocateDiscoverHostSocket(root);
    await bindSocket(allocation.socketPath);

    await expect(isTrustedDiscoverHostSocketPath(undefined)).resolves.toBe(false);
    await expect(isTrustedDiscoverHostSocketPath(join(root, "missing", "host.sock"))).resolves.toBe(
      false,
    );
    await expect(
      isTrustedDiscoverHostSocketPath(join(allocation.socketDirectory, "other.sock")),
    ).resolves.toBe(false);
  });

  it("rejects a socket directory that is group or world accessible", async () => {
    const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
    directories.push(root);
    const allocation = await allocateDiscoverHostSocket(root);
    await bindSocket(allocation.socketPath);
    await chmod(allocation.socketDirectory, 0o755);

    await expect(isTrustedDiscoverHostSocketPath(allocation.socketPath)).resolves.toBe(false);
  });

  it("rejects a socket that is group or world accessible", async () => {
    const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
    directories.push(root);
    const allocation = await allocateDiscoverHostSocket(root);
    await bindSocket(allocation.socketPath);
    await chmod(allocation.socketPath, 0o660);

    await expect(isTrustedDiscoverHostSocketPath(allocation.socketPath)).resolves.toBe(false);
  });

  it("rejects a symlinked socket directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
    directories.push(root);
    const allocation = await allocateDiscoverHostSocket(root);
    await bindSocket(allocation.socketPath);
    const linkedDirectory = join(root, "linked");
    await symlink(allocation.socketDirectory, linkedDirectory);

    await expect(isTrustedDiscoverHostSocketPath(join(linkedDirectory, "host.sock"))).resolves.toBe(
      false,
    );
  });

  it("rejects a symlink in place of the socket", async () => {
    const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
    directories.push(root);
    const allocation = await allocateDiscoverHostSocket(root);
    await bindSocket(allocation.socketPath);
    const otherDirectory = join(root, "other");
    await mkdir(otherDirectory, { mode: 0o700 });
    const linkedSocket = join(otherDirectory, "host.sock");
    await symlink(allocation.socketPath, linkedSocket);

    await expect(isTrustedDiscoverHostSocketPath(linkedSocket)).resolves.toBe(false);
  });

  it("rejects a regular file in place of the socket", async () => {
    const root = await mkdtemp(join(tmpdir(), "adc-sock-test-"));
    directories.push(root);
    const allocation = await allocateDiscoverHostSocket(root);
    await writeFile(allocation.socketPath, "not a socket", { mode: 0o600 });

    await expect(isTrustedDiscoverHostSocketPath(allocation.socketPath)).resolves.toBe(false);
  });
});
