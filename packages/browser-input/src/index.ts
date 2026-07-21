export type ScreenPoint = { x: number; y: number };

export type NaturalInputEvent =
  | { kind: "move"; point: ScreenPoint }
  | { kind: "down"; button: "left" }
  | { kind: "up"; button: "left" }
  | { kind: "wheel"; deltaX: number; deltaY: number }
  | { kind: "keypress"; key: string }
  | { kind: "type"; text: string }
  | { kind: "wait"; durationMs: number };

export type NaturalInputPort = {
  move(point: ScreenPoint): Promise<void>;
  down(button: "left"): Promise<void>;
  up(button: "left"): Promise<void>;
  wheel(deltaX: number, deltaY: number): Promise<void>;
  keypress(key: string): Promise<void>;
  type(text: string): Promise<void>;
  wait(durationMs: number): Promise<void>;
};

export type NaturalInputDriver = {
  pointer(): ScreenPoint;
  move(destination: ScreenPoint): Promise<void>;
  click(destination: ScreenPoint): Promise<void>;
  doubleClick(destination: ScreenPoint): Promise<void>;
  scroll(destination: ScreenPoint, deltaX: number, deltaY: number): Promise<void>;
  keypress(keys: string[]): Promise<void>;
  type(text: string): Promise<void>;
};

export type NaturalInputOptions = {
  pointer: ScreenPoint;
  settleMs?: number;
  doubleClickIntervalMs?: number;
};

export function createNaturalInputDriver(
  port: NaturalInputPort,
  options: NaturalInputOptions,
): NaturalInputDriver {
  assertPoint(options.pointer);
  let pointer = screenPoint(options.pointer);
  const settleMs = options.settleMs ?? 40;
  const doubleClickIntervalMs = options.doubleClickIntervalMs ?? 80;

  const move = async (destination: ScreenPoint) => {
    assertPoint(destination);
    const origin = pointer;
    const distance = Math.hypot(destination.x - origin.x, destination.y - origin.y);
    if (distance === 0) return;
    const steps = Math.max(3, Math.min(36, Math.ceil(distance / 24)));
    const bend = Math.min(48, distance * 0.12);
    const control = {
      x: origin.x + (destination.x - origin.x) * 0.5 - bend,
      y: origin.y + (destination.y - origin.y) * 0.5 + bend,
    };
    for (let index = 1; index <= steps; index += 1) {
      const progress = index / steps;
      const eased = progress * progress * (3 - 2 * progress);
      const remaining = 1 - eased;
      const point =
        index === steps
          ? screenPoint(destination)
          : {
              x:
                remaining * remaining * origin.x +
                2 * remaining * eased * control.x +
                eased * eased * destination.x,
              y:
                remaining * remaining * origin.y +
                2 * remaining * eased * control.y +
                eased * eased * destination.y,
            };
      await port.move(point);
    }
    pointer = screenPoint(destination);
  };

  const settle = async () => {
    if (settleMs > 0) await port.wait(settleMs);
  };

  const physicalClick = async () => {
    await port.down("left");
    await port.up("left");
  };

  return {
    pointer: () => screenPoint(pointer),
    move,
    async click(destination) {
      await move(destination);
      await settle();
      await physicalClick();
    },
    async doubleClick(destination) {
      await move(destination);
      await settle();
      await physicalClick();
      if (doubleClickIntervalMs > 0) await port.wait(doubleClickIntervalMs);
      await physicalClick();
    },
    async scroll(destination, deltaX, deltaY) {
      await move(destination);
      await settle();
      await port.wheel(deltaX, deltaY);
      await settle();
    },
    async keypress(keys) {
      for (const key of keys) await port.keypress(key);
    },
    async type(text) {
      await port.type(text);
    },
  };
}

function assertPoint(point: ScreenPoint): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error("invalid coordinates");
  }
}

function screenPoint(point: ScreenPoint): ScreenPoint {
  return { x: point.x, y: point.y };
}
