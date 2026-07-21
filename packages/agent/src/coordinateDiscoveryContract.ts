export const COORDINATE_DISCOVERY_LIMITS = {
  actionsPerBatch: 16,
  keysPerAction: 32,
  typeCharacters: 2_000,
  waitDurationMs: 30_000,
  wheelDelta: 4_000,
} as const;

export type CoordinateDiscoveryAction =
  | { type: "move"; x: number; y: number }
  | { type: "click"; x: number; y: number }
  | { type: "double-click"; x: number; y: number }
  | { type: "scroll"; x: number; y: number; deltaX?: number; deltaY: number }
  | { type: "keypress"; keys: string[] }
  | { type: "type"; text: string; binding?: string }
  | { type: "wait"; durationMs: number };

export type CoordinateActionBatch = {
  frameId: string;
  actions: CoordinateDiscoveryAction[];
};

export type CoordinateFrame = {
  id: string;
  screenshotPath: string;
  width: number;
  height: number;
  deviceScaleFactor: 1;
  pointer: { x: number; y: number };
};

export type CoordinateDiscoveryContractError = {
  code: "invalid_action_batch";
  message: string;
  actionIndex?: number;
};

export type CoordinateActionBatchResult =
  | { ok: true; batch: CoordinateActionBatch }
  | { ok: false; errors: CoordinateDiscoveryContractError[] };

const NAMED_KEYS = new Set([
  "ENTER",
  "ESCAPE",
  "TAB",
  "ARROWDOWN",
  "ARROWUP",
  "PAGEUP",
  "PAGEDOWN",
  "HOME",
  "END",
  "SPACE",
  "BACKSPACE",
  "DELETE",
]);

export function parseCoordinateActionBatch(
  value: unknown,
  viewport: { width: number; height: number },
): CoordinateActionBatchResult {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["frameId", "actions"]) ||
    !isSafeId(value.frameId) ||
    !Array.isArray(value.actions) ||
    value.actions.length < 1 ||
    value.actions.length > COORDINATE_DISCOVERY_LIMITS.actionsPerBatch ||
    !isViewport(viewport)
  ) {
    return invalid();
  }

  const actions: CoordinateDiscoveryAction[] = [];
  for (let index = 0; index < value.actions.length; index += 1) {
    const action = parseAction(value.actions[index], viewport);
    if (action === undefined) return invalid(index);
    actions.push(action);
  }
  return { ok: true, batch: { frameId: value.frameId, actions } };
}

function parseAction(
  value: unknown,
  viewport: { width: number; height: number },
): CoordinateDiscoveryAction | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined;
  if (value.type === "move" || value.type === "click" || value.type === "double-click") {
    if (!hasOnlyKeys(value, ["type", "x", "y"]) || !isPoint(value, viewport)) return undefined;
    return { type: value.type, x: value.x, y: value.y };
  }
  if (value.type === "scroll") {
    if (!hasOnlyKeys(value, ["type", "x", "y", "deltaX", "deltaY"])) return undefined;
    if (!isPoint(value, viewport) || !isWheelDelta(value.deltaY)) return undefined;
    if (value.deltaX !== undefined && !isWheelDelta(value.deltaX)) return undefined;
    return {
      type: "scroll",
      x: value.x,
      y: value.y,
      ...(value.deltaX === undefined ? {} : { deltaX: value.deltaX }),
      deltaY: value.deltaY,
    };
  }
  if (value.type === "keypress") {
    if (
      !hasOnlyKeys(value, ["type", "keys"]) ||
      !Array.isArray(value.keys) ||
      value.keys.length < 1 ||
      value.keys.length > COORDINATE_DISCOVERY_LIMITS.keysPerAction ||
      !value.keys.every(isSupportedKey)
    ) {
      return undefined;
    }
    return { type: "keypress", keys: [...value.keys] };
  }
  if (value.type === "type") {
    if (
      !hasOnlyKeys(value, ["type", "text", "binding"]) ||
      typeof value.text !== "string" ||
      value.text.length > COORDINATE_DISCOVERY_LIMITS.typeCharacters ||
      (value.binding !== undefined && !isSafeId(value.binding))
    ) {
      return undefined;
    }
    return {
      type: "type",
      text: value.text,
      ...(value.binding === undefined ? {} : { binding: value.binding }),
    };
  }
  if (value.type === "wait") {
    if (
      !hasOnlyKeys(value, ["type", "durationMs"]) ||
      !Number.isInteger(value.durationMs) ||
      typeof value.durationMs !== "number" ||
      value.durationMs < 0 ||
      value.durationMs > COORDINATE_DISCOVERY_LIMITS.waitDurationMs
    ) {
      return undefined;
    }
    return { type: "wait", durationMs: value.durationMs };
  }
  return undefined;
}

function isPoint(
  value: Record<string, unknown>,
  viewport: { width: number; height: number },
): value is Record<string, unknown> & { x: number; y: number } {
  return (
    typeof value.x === "number" &&
    Number.isInteger(value.x) &&
    value.x >= 0 &&
    value.x < viewport.width &&
    typeof value.y === "number" &&
    Number.isInteger(value.y) &&
    value.y >= 0 &&
    value.y < viewport.height
  );
}

function isWheelDelta(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Math.abs(value) <= COORDINATE_DISCOVERY_LIMITS.wheelDelta
  );
}

function isSupportedKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (NAMED_KEYS.has(value)) return true;
  return [...value].length === 1 && !/[\p{Cc}\p{Cs}]/u.test(value);
}

function isViewport(value: { width: number; height: number }): boolean {
  return (
    Number.isInteger(value.width) &&
    value.width > 0 &&
    Number.isInteger(value.height) &&
    value.height > 0
  );
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key));
}

function invalid(actionIndex?: number): CoordinateActionBatchResult {
  return {
    ok: false,
    errors: [
      {
        code: "invalid_action_batch",
        message: "Coordinate discovery action batch is invalid.",
        ...(actionIndex === undefined ? {} : { actionIndex }),
      },
    ],
  };
}
