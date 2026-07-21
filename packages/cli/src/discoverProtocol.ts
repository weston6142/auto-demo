import { timingSafeEqual } from "node:crypto";
import { createConnection, createServer, type Server, type Socket } from "node:net";

const MAX_MESSAGE_BYTES = 256_000;

export type DiscoverHostRequest = {
  command: string;
  sessionId: string;
  payload?: unknown;
};

export type DiscoverHostResponse = Record<string, unknown> & { ok: boolean };

export type DiscoverHostServer = {
  close(): Promise<void>;
};

export async function createDiscoverHostServer(input: {
  socketPath: string;
  token: string;
  handle(request: DiscoverHostRequest): Promise<DiscoverHostResponse>;
}): Promise<DiscoverHostServer> {
  const server = createServer((socket) => {
    void readFrame(socket).then(async (value) => {
      if (!value.ok) return writeResponse(socket, value);
      const envelope = value.value;
      if (!isEnvelope(envelope) || !tokensEqual(envelope.token, input.token)) {
        return writeResponse(socket, rejected());
      }
      try {
        return writeResponse(socket, await input.handle(envelope.request));
      } catch {
        return writeResponse(socket, {
          ok: false,
          code: "discover_host_failed",
          message: "Discover host request failed safely.",
        });
      }
    });
  });
  await listen(server, input.socketPath);
  return { close: () => closeServer(server) };
}

export async function sendDiscoverHostRequest(input: {
  socketPath: string;
  token: string;
  request: DiscoverHostRequest;
}): Promise<DiscoverHostResponse> {
  const bytes = Buffer.from(JSON.stringify({ token: input.token, request: input.request }), "utf8");
  if (bytes.byteLength > MAX_MESSAGE_BYTES) {
    return {
      ok: false,
      code: "discover_request_too_large",
      message: "Discover host request exceeded its size limit.",
    };
  }
  return await new Promise((resolve) => {
    const socket = createConnection(input.socketPath);
    socket.once("error", () =>
      resolve({
        ok: false,
        code: "discovery_host_unavailable",
        message: "Discover host is unavailable.",
      }),
    );
    socket.once("connect", () => writeFrame(socket, bytes));
    void readFrame(socket).then((result) => {
      socket.end();
      resolve(
        result.ok && isResponse(result.value)
          ? result.value
          : {
              ok: false,
              code: "discover_invalid_response",
              message: "Discover host returned an invalid response.",
            },
      );
    });
  });
}

type FrameReadResult = { ok: true; value: unknown } | { ok: false; code: string; message: string };

function readFrame(socket: Socket): Promise<FrameReadResult> {
  return new Promise((resolve) => {
    let buffer = Buffer.alloc(0);
    let finished = false;
    const finish = (result: FrameReadResult) => {
      if (finished) return;
      finished = true;
      socket.removeAllListeners("data");
      resolve(result);
    };
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.byteLength < 4) return;
      const length = buffer.readUInt32BE(0);
      if (length > MAX_MESSAGE_BYTES) {
        finish({
          ok: false,
          code: "discover_request_too_large",
          message: "Discover host request exceeded its size limit.",
        });
        return;
      }
      if (buffer.byteLength < length + 4) return;
      try {
        finish({ ok: true, value: JSON.parse(buffer.subarray(4, length + 4).toString("utf8")) });
      } catch {
        finish({
          ok: false,
          code: "discover_invalid_request",
          message: "Discover host request is invalid.",
        });
      }
    });
    socket.once("error", () =>
      finish({
        ok: false,
        code: "discovery_host_unavailable",
        message: "Discover host is unavailable.",
      }),
    );
  });
}

function writeResponse(socket: Socket, response: DiscoverHostResponse): void {
  const bytes = Buffer.from(JSON.stringify(response), "utf8");
  if (bytes.byteLength > MAX_MESSAGE_BYTES) {
    writeFrame(
      socket,
      Buffer.from(
        JSON.stringify({
          ok: false,
          code: "discover_response_too_large",
          message: "Discover host response exceeded its size limit.",
        }),
      ),
    );
    return;
  }
  writeFrame(socket, bytes);
}

function writeFrame(socket: Socket, bytes: Buffer): void {
  const header = Buffer.alloc(4);
  header.writeUInt32BE(bytes.byteLength, 0);
  socket.end(Buffer.concat([header, bytes]));
}

function isEnvelope(value: unknown): value is { token: string; request: DiscoverHostRequest } {
  if (!isRecord(value) || typeof value.token !== "string" || !isRecord(value.request)) return false;
  return typeof value.request.command === "string" && typeof value.request.sessionId === "string";
}

function isResponse(value: unknown): value is DiscoverHostResponse {
  return isRecord(value) && typeof value.ok === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function tokensEqual(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function rejected(): DiscoverHostResponse {
  return {
    ok: false,
    code: "discover_authentication_failed",
    message: "Discover host request was rejected.",
  };
}

function listen(server: Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
