export type CaptureEventType =
  | "capture_started"
  | "capture_stopped"
  | "navigation"
  | "click"
  | "fill"
  | "press"
  | "viewport"
  | "console"
  | "page_error"
  | "agent_step";

export type CaptureEvent = {
  id: string;
  sequence: number;
  type: CaptureEventType;
  timestampMs: number;
  pageUrl?: string;
  pageTitle?: string;
  viewport?: {
    width: number;
    height: number;
  };
  data?: Record<string, unknown>;
};

export type CapturedValueKind =
  "email_like" | "url_like" | "number_like" | "short_text" | "long_text" | "password" | "unknown";

export type CapturedValueInput = {
  value: string | undefined;
  inputType: string | undefined;
};

export type RedactedCapturedValue = {
  redacted: true;
  valueKind: CapturedValueKind;
  valueLength?: number;
};

export type CaptureTargetHint = {
  tagName?: string;
  inputType?: string;
  role?: string;
  label?: string;
  text?: string;
  selector?: string;
};

export type CaptureEventFactory = {
  reserveTimestamp(): number;
  create(
    type: CaptureEventType,
    fields?: Omit<CaptureEvent, "id" | "sequence" | "type" | "timestampMs">,
    options?: { timestampMs?: number },
  ): CaptureEvent;
};

export function createCaptureEventFactory(options: {
  captureStartedAt: Date;
  now: () => Date;
}): CaptureEventFactory {
  let sequence = 0;

  return {
    reserveTimestamp() {
      return Math.max(0, options.now().getTime() - options.captureStartedAt.getTime());
    },
    create(type, fields = {}, createOptions = {}) {
      sequence += 1;
      return {
        id: `event-${sequence}`,
        sequence,
        type,
        timestampMs: createOptions.timestampMs ?? this.reserveTimestamp(),
        ...fields,
      };
    },
  };
}

export function redactCapturedValue(input: CapturedValueInput): RedactedCapturedValue {
  const valueKind = classifyCapturedValue(input);
  if (valueKind === "password") {
    return { redacted: true, valueKind };
  }

  return {
    redacted: true,
    valueKind,
    valueLength: input.value?.length ?? 0,
  };
}

export function classifyCapturedValue(input: CapturedValueInput): CapturedValueKind {
  const inputType = input.inputType?.toLowerCase();
  const value = input.value ?? "";

  if (inputType === "password") {
    return "password";
  }

  if (value.length === 0) {
    return "unknown";
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return "email_like";
  }

  if (/^https?:\/\/\S+$/i.test(value)) {
    return "url_like";
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return "number_like";
  }

  return value.length > 80 ? "long_text" : "short_text";
}
