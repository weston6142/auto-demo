import { lstat, readFile } from "node:fs/promises";

export type DiscoverRisk = "safe" | "public-browse" | "disposable" | "yolo";

export type DiscoverStartInput = {
  url: string;
  goal: string;
  risk: DiscoverRisk;
  allowedOrigins: string[];
  grid: boolean;
};

export type DiscoverCommandBackend = {
  start(input: DiscoverStartInput): Promise<Record<string, unknown> & { ok: boolean }>;
  request(
    sessionId: string,
    command: "observe" | "act" | "status" | "finish" | "abandon",
    payload?: unknown,
  ): Promise<Record<string, unknown> & { ok: boolean }>;
};

export type DiscoverCliResult = { exitCode: number; stdout: string; stderr: string };

const LIFECYCLE_COMMANDS = new Set(["observe", "act", "status", "finish", "abandon"]);

export async function runDiscoverCommand(
  args: string[],
  backend: DiscoverCommandBackend,
): Promise<DiscoverCliResult> {
  if (!args.includes("--json")) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "autodemo discover currently requires --json output.\n",
    };
  }
  const [command, ...rest] = args;
  if (command === "start") {
    const parsed = parseStart(rest);
    if (!parsed.ok) return jsonFailure();
    return jsonResult(await backend.start(parsed.input));
  }
  if (command === undefined || !LIFECYCLE_COMMANDS.has(command)) return jsonFailure();
  const parsed = parseLifecycle(command, rest);
  if (!parsed.ok) return jsonFailure();
  let payload: unknown;
  if (command === "act") {
    const actions = await readActions(parsed.actionsPath!);
    if (!actions.ok) return jsonFailure();
    payload = { actions: actions.value };
  }
  return jsonResult(
    await backend.request(
      parsed.sessionId,
      command as "observe" | "act" | "status" | "finish" | "abandon",
      payload,
    ),
  );
}

function parseStart(args: string[]): { ok: true; input: DiscoverStartInput } | { ok: false } {
  let url: string | undefined;
  let goal: string | undefined;
  let risk: DiscoverRisk | undefined;
  let grid = false;
  const allowedOrigins: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--json") continue;
    if (argument === "--grid") {
      grid = true;
      continue;
    }
    if (["--url", "--goal", "--risk", "--allowed-origin"].includes(argument)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false };
      index += 1;
      if (argument === "--url") url = value;
      else if (argument === "--goal") goal = value;
      else if (argument === "--risk") {
        if (!isRisk(value)) return { ok: false };
        risk = value;
      } else {
        const origin = normalizeOrigin(value);
        if (origin === undefined) return { ok: false };
        allowedOrigins.push(origin);
      }
      continue;
    }
    return { ok: false };
  }
  if (
    url === undefined ||
    goal === undefined ||
    goal.trim().length < 1 ||
    goal.length > 2_000 ||
    risk === undefined ||
    !isHttpsUrl(url)
  ) {
    return { ok: false };
  }
  return { ok: true, input: { url, goal, risk, allowedOrigins, grid } };
}

function parseLifecycle(
  command: string,
  args: string[],
): { ok: true; sessionId: string; actionsPath?: string } | { ok: false } {
  let sessionId: string | undefined;
  let actionsPath: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--json") continue;
    if (argument === "--session" || argument === "--actions-file") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) return { ok: false };
      index += 1;
      if (argument === "--session") sessionId = value;
      else actionsPath = value;
      continue;
    }
    return { ok: false };
  }
  if (!isSafeId(sessionId)) return { ok: false };
  if ((command === "act") !== (actionsPath !== undefined)) return { ok: false };
  return { ok: true, sessionId, ...(actionsPath === undefined ? {} : { actionsPath }) };
}

async function readActions(path: string): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > 256_000) {
      return { ok: false };
    }
    return { ok: true, value: JSON.parse(await readFile(path, "utf8")) };
  } catch {
    return { ok: false };
  }
}

function jsonResult(value: Record<string, unknown> & { ok: boolean }): DiscoverCliResult {
  return {
    exitCode: value.ok ? 0 : 1,
    stdout: `${JSON.stringify(value, null, 2)}\n`,
    stderr: "",
  };
}

function jsonFailure(): DiscoverCliResult {
  return jsonResult({
    ok: false,
    errors: [
      { code: "invalid_discover_command", message: "Autodemo discover command is invalid." },
    ],
  });
}

function isRisk(value: string): value is DiscoverRisk {
  return ["safe", "public-browse", "disposable", "yolo"].includes(value);
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(value);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.pathname === "/" && url.search === "" && url.hash === ""
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}
