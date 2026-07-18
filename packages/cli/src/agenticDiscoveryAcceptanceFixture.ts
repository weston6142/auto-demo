import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const DISCARDED_TARGET_CANARY = "sk-discardedtarget123456";
export const QUERY_CANARY = "query-canary-987";
export const RUNTIME_CANARY = "runtime-canary-987";
export const FAILURE_DETAIL_CANARY = "failure-detail-canary-private-987";

export type AgenticDiscoveryAcceptanceFixture = {
  origin: string;
  storiesUrl: string;
  firstStoryUrl: string;
  profileUrl: string;
  mutationCount(): number;
  useRepairedStoryTarget(): void;
  removeStoryTarget(): void;
  close(): Promise<void>;
};

export async function startAgenticDiscoveryAcceptanceFixture(): Promise<AgenticDiscoveryAcceptanceFixture> {
  let repairedStoryTarget = false;
  let storyTargetRemoved = false;
  let mutations = 0;
  const server = createServer((request, response) => {
    void handleRequest(request, response, {
      repairedStoryTarget: () => repairedStoryTarget,
      storyTargetRemoved: () => storyTargetRemoved,
      recordMutation: () => {
        mutations += 1;
      },
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("acceptance fixture requires a TCP address");
  }
  const origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    storiesUrl: `${origin}/stories?view=${QUERY_CANARY}`,
    firstStoryUrl: `${origin}/stories/first`,
    profileUrl: `${origin}/profile`,
    mutationCount: () => mutations,
    useRepairedStoryTarget() {
      repairedStoryTarget = true;
    },
    removeStoryTarget() {
      storyTargetRemoved = true;
    },
    close: () => closeServer(server),
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  state: {
    repairedStoryTarget(): boolean;
    storyTargetRemoved(): boolean;
    recordMutation(): void;
  },
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://fixture.invalid");
  if (request.method === "GET" && url.pathname === "/stories") {
    return html(
      response,
      page(
        "Stories",
        `<main>
          <h1>Stories</h1>
          <article><h2>First story</h2><a href="/stories/first">Read story</a></article>
          <article><h2>Second story</h2><a href="/stories/second">Read story</a></article>
        </main>`,
      ),
    );
  }
  if (request.method === "GET" && url.pathname === "/stories/first") {
    const actionLabel = state.repairedStoryTarget()
      ? "Open story"
      : `Continue story ${DISCARDED_TARGET_CANARY}`;
    const action = state.storyTargetRemoved()
      ? `<p>${FAILURE_DETAIL_CANARY}</p>`
      : `<button type="button" onclick="document.querySelector('output').textContent='Story ready'">${actionLabel}</button>`;
    return html(
      response,
      page(
        "First story",
        `<main>
          <h1>First story</h1>
          <label>Story note <input /></label>
          ${action}
          <output>Waiting</output>
        </main>`,
      ),
    );
  }
  if (request.method === "GET" && url.pathname === "/stories/second") {
    return html(response, page("Second story", "<main><h1>Second story</h1></main>"));
  }
  if (request.method === "GET" && url.pathname === "/profile") {
    return html(
      response,
      page(
        "Profile",
        `<main>
          <h1>Profile</h1>
          <form onsubmit="event.preventDefault(); fetch('/profile/save', { method: 'POST' }).then(() => document.querySelector('output').textContent='Profile saved')">
            <button type="submit">Save profile</button>
          </form>
          <output>Not saved</output>
        </main>`,
      ),
    );
  }
  if (url.pathname === "/profile/save") {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    state.recordMutation();
    response.writeHead(204).end();
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

function html(response: ServerResponse, body: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}
