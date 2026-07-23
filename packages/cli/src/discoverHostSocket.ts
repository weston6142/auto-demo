import { chmod, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const SOCKET_FILENAME = "host.sock";

export type DiscoverHostSocketAllocation = {
  socketDirectory: string;
  socketPath: string;
  cleanup(): Promise<void>;
};

export async function allocateDiscoverHostSocket(
  temporaryDirectory: string = tmpdir(),
): Promise<DiscoverHostSocketAllocation> {
  const socketDirectory = await mkdtemp(join(temporaryDirectory, "adc-host-"));
  await chmod(socketDirectory, 0o700);
  return {
    socketDirectory,
    socketPath: join(socketDirectory, SOCKET_FILENAME),
    async cleanup() {
      await rm(socketDirectory, { recursive: true, force: true });
    },
  };
}

export async function isTrustedDiscoverHostSocketPath(socketPath: unknown): Promise<boolean> {
  if (typeof socketPath !== "string" || basename(socketPath) !== SOCKET_FILENAME) return false;
  try {
    const directoryMetadata = await lstat(dirname(socketPath));
    if (!directoryMetadata.isDirectory()) return false;
    const uid = process.getuid?.();
    if (uid !== undefined && directoryMetadata.uid !== uid) return false;
    if ((directoryMetadata.mode & 0o077) !== 0) return false;
    const socketMetadata = await lstat(socketPath);
    return socketMetadata.isSocket();
  } catch {
    return false;
  }
}
