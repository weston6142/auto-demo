import { chmod, lstat, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

const SOCKET_FILENAME = "host.sock";
const MAX_SOCKET_PATH_BYTES = 103;

export type DiscoverHostSocketAllocation = {
  socketDirectory: string;
  socketPath: string;
  cleanup(): Promise<void>;
};

export async function allocateDiscoverHostSocket(
  temporaryDirectory: string = tmpdir(),
): Promise<DiscoverHostSocketAllocation> {
  const socketDirectory = await mkdtemp(join(temporaryDirectory, "adc-host-"));
  try {
    await chmod(socketDirectory, 0o700);
    const socketPath = join(socketDirectory, SOCKET_FILENAME);
    if (Buffer.byteLength(socketPath, "utf8") > MAX_SOCKET_PATH_BYTES) {
      throw new Error("Discover host socket path exceeds the supported byte limit.");
    }
    return {
      socketDirectory,
      socketPath,
      async cleanup() {
        await rm(socketDirectory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    await rm(socketDirectory, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
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
    if (!socketMetadata.isSocket()) return false;
    if (uid !== undefined && socketMetadata.uid !== uid) return false;
    return (socketMetadata.mode & 0o077) === 0;
  } catch {
    return false;
  }
}
