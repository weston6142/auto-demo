import {
  createDiscoverHostServer,
  type DiscoverHostResponse,
  type DiscoverHostServer,
} from "./discoverProtocol.js";

export type DiscoverHostRuntime = {
  observe(): Promise<DiscoverHostResponse>;
  act(actions: unknown): Promise<DiscoverHostResponse>;
  status(): Promise<DiscoverHostResponse>;
  finish(): Promise<DiscoverHostResponse>;
  abandon(): Promise<DiscoverHostResponse>;
  close(): Promise<void>;
};

export type DiscoverSessionHost = {
  close(): Promise<void>;
};

export async function createDiscoverSessionHost(input: {
  socketPath: string;
  token: string;
  sessionId: string;
  runtime: DiscoverHostRuntime;
}): Promise<DiscoverSessionHost> {
  let server: DiscoverHostServer;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await server.close();
    await input.runtime.close();
  };
  server = await createDiscoverHostServer({
    socketPath: input.socketPath,
    token: input.token,
    async handle(request) {
      if (request.sessionId !== input.sessionId) {
        return {
          ok: false,
          code: "discover_session_mismatch",
          message: "Discover host session does not match.",
        };
      }
      switch (request.command) {
        case "observe":
          return await input.runtime.observe();
        case "status":
          return await input.runtime.status();
        case "finish":
          return await input.runtime.finish();
        case "abandon": {
          const response = await input.runtime.abandon();
          setTimeout(() => void close(), 0);
          return response;
        }
        case "act": {
          if (!isRecord(request.payload) || !("actions" in request.payload)) {
            return {
              ok: false,
              code: "discover_invalid_request",
              message: "Discover host request is invalid.",
            };
          }
          return await input.runtime.act(request.payload.actions);
        }
        default:
          return {
            ok: false,
            code: "discover_invalid_request",
            message: "Discover host request is invalid.",
          };
      }
    },
  });
  return { close };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
