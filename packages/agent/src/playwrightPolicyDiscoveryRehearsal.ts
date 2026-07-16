import type { Page } from "playwright";
import {
  hasCredentialLikeUrlData,
  isSecretLikeValue,
  normalizeHttpOrigin,
} from "./actionSafety.js";
import { DISCOVERY_LIMITS } from "./discoveryContract.js";
import {
  DISCOVERY_POLICY_SUMMARIES,
  authorizeDiscoveryPolicyAction,
  validateDiscoveryPolicy,
  type DiscoveryPolicy,
  type DiscoveryPolicyOutcomeCode,
  type DiscoveryPolicyPermit,
  type DiscoveryPolicyValidationErrorCode,
} from "./discoveryPolicy.js";
import {
  createDiscoveryRehearsalController,
  type DiscoveryActionAuthorizer,
  type DiscoveryInputResolver,
  type DiscoveryRehearsalResult,
} from "./discoveryRehearsal.js";
import type {
  DiscoveryObservationArtifactSink,
  DiscoveryObservationIdKind,
} from "./discoveryObservation.js";
import {
  createPlaywrightDiscoveryRehearsalRuntime,
  type PlaywrightDiscoveryDriverHooks,
} from "./playwrightDiscoveryRehearsal.js";
import {
  DiscoveryPolicyGuardError,
  installPlaywrightDiscoveryPolicyGuard,
  type PlaywrightDiscoveryPolicyGuard,
} from "./playwrightDiscoveryPolicyGuard.js";

export type DiscoveryPolicyControllerErrorCode =
  | DiscoveryPolicyValidationErrorCode
  | "policy_guard_unavailable"
  | "discovery_policy_controller_disposed";

export class DiscoveryPolicyControllerError extends Error {
  constructor(
    readonly code: DiscoveryPolicyControllerErrorCode,
    private cleanupOperation?: () => Promise<void>,
  ) {
    super("Policy-enforced discovery controller setup failed.");
    this.name = "DiscoveryPolicyControllerError";
  }

  async cleanup(): Promise<void> {
    if (this.cleanupOperation === undefined) return;
    await this.cleanupOperation();
    this.cleanupOperation = undefined;
  }
}

export type PlaywrightPolicyDiscoveryRehearsalOptions = {
  chromiumNetworkInstrumentation: "exclusive";
  policy: DiscoveryPolicy;
  inputResolver: DiscoveryInputResolver;
  artifactSink?: DiscoveryObservationArtifactSink;
  observationClock?: () => string;
  observationIdGenerator?: (kind: DiscoveryObservationIdKind) => string;
  clock?: () => string;
  attemptIdGenerator?: () => string;
};

export async function createPolicyEnforcedPlaywrightDiscoveryRehearsalController(
  page: Page,
  options: PlaywrightPolicyDiscoveryRehearsalOptions,
) {
  if (options.chromiumNetworkInstrumentation !== "exclusive") {
    throw new DiscoveryPolicyControllerError("policy_guard_unavailable");
  }
  const validated = validateDiscoveryPolicy(options.policy, page.url());
  if (!validated.ok) {
    throw new DiscoveryPolicyControllerError(validated.errors[0]!.code);
  }

  let guard: PlaywrightDiscoveryPolicyGuard;
  try {
    guard = await installPlaywrightDiscoveryPolicyGuard(page, validated.policy);
  } catch (error) {
    if (error instanceof DiscoveryPolicyGuardError) {
      throw new DiscoveryPolicyControllerError(error.code, () => error.cleanup());
    }
    throw new DiscoveryPolicyControllerError("policy_guard_unavailable");
  }

  const hooks: PlaywrightDiscoveryDriverHooks<DiscoveryPolicyPermit> = {
    beforeExecute({ action, permit, resolvedValue }) {
      if (
        action.kind === "type" &&
        (resolvedValue === undefined ||
          resolvedValue.length > DISCOVERY_LIMITS.publicStringCharacters ||
          isSecretLikeValue(resolvedValue))
      ) {
        return policyDriverFailure("sensitive_input_blocked");
      }
      try {
        guard.arm(permit);
        return undefined;
      } catch {
        return policyDriverFailure("policy_guard_unavailable");
      }
    },
    async afterExecute() {
      const violation = await guard.finishAction();
      return violation === undefined ? undefined : policyDriverFailure(violation.code);
    },
  };

  const runtime = createPlaywrightDiscoveryRehearsalRuntime<DiscoveryPolicyPermit>(
    page,
    options,
    hooks,
  );
  const authorizer: DiscoveryActionAuthorizer<DiscoveryPolicyPermit> = {
    async authorize(input) {
      const targetId =
        input.action.kind === "click" || input.action.kind === "type"
          ? input.action.targetId
          : undefined;
      return authorizeDiscoveryPolicyAction({
        policy: validated.policy,
        observationUrl: input.observation.page.url,
        action: input.action,
        ...(input.target === undefined ? {} : { target: input.target }),
        ...(targetId === undefined ? {} : { risk: runtime.registry.resolve(targetId)?.risk }),
      });
    },
  };
  const controller = createDiscoveryRehearsalController({
    driver: runtime.driver,
    authorizer,
    inputResolver: options.inputResolver,
    driverFailureOutcome: (result) =>
      isDiscoveryPolicyOutcomeCode(result.code)
        ? { code: result.code, summary: DISCOVERY_POLICY_SUMMARIES[result.code] }
        : undefined,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.attemptIdGenerator === undefined
      ? {}
      : { idGenerator: options.attemptIdGenerator }),
  });

  let disposed = false;
  let disposing = false;
  let activeOperations = 0;
  let disposalPromise: Promise<void> | undefined;
  const idleWaiters = new Set<() => void>();
  const disposedResult = (): DiscoveryRehearsalResult => {
    const session = controller.getSession();
    return {
      ok: false,
      ...(session === undefined ? {} : { session }),
      errors: [
        {
          code: "discovery_policy_controller_disposed",
          message: "Policy-enforced discovery controller is disposed.",
        },
      ],
    };
  };
  const scopeFailureResult = (): DiscoveryRehearsalResult => ({
    ok: false,
    errors: [
      {
        code: "origin_not_allowed",
        message: "The current page origin is outside the approved discovery scope.",
      },
    ],
  });
  const cleanupFailureResult = (): DiscoveryRehearsalResult => ({
    ok: false,
    ...(controller.getSession() === undefined ? {} : { session: controller.getSession() }),
    errors: [
      {
        code: "policy_guard_unavailable",
        message: DISCOVERY_POLICY_SUMMARIES.policy_guard_unavailable,
      },
    ],
  });

  const runOperation = async (
    operation: () => Promise<DiscoveryRehearsalResult>,
  ): Promise<DiscoveryRehearsalResult> => {
    if (disposed || disposing) return disposedResult();
    activeOperations += 1;
    try {
      return await operation();
    } finally {
      activeOperations -= 1;
      if (activeOperations === 0) {
        for (const resolve of idleWaiters) resolve();
        idleWaiters.clear();
      }
    }
  };

  const waitForIdle = async () => {
    if (activeOperations === 0) return;
    await new Promise<void>((resolve) => idleWaiters.add(resolve));
  };

  const currentPageIsInScope = () => {
    const url = page.url();
    if (hasCredentialLikeUrlData(url)) return false;
    const origin = normalizeHttpOrigin(url);
    return origin !== undefined && validated.policy.allowedOrigins.has(origin);
  };

  return {
    getSession: controller.getSession,
    start: (input: Parameters<typeof controller.start>[0]) =>
      runOperation(async () =>
        currentPageIsInScope() ? controller.start(input) : scopeFailureResult(),
      ),
    perform: (input: Parameters<typeof controller.perform>[0]) =>
      runOperation(() => controller.perform(input)),
    async stop(input: Parameters<typeof controller.stop>[0]) {
      return runOperation(async () => {
        const result = await controller.stop(input);
        if (!result.ok) return result;
        try {
          await guard.dispose();
          disposed = true;
          return result;
        } catch {
          return cleanupFailureResult();
        }
      });
    },
    async dispose() {
      if (disposed) return;
      if (disposalPromise !== undefined) return disposalPromise;
      disposing = true;
      disposalPromise = (async () => {
        await waitForIdle();
        try {
          await guard.dispose();
          disposed = true;
        } catch {
          throw new DiscoveryPolicyControllerError("policy_guard_unavailable");
        } finally {
          disposing = false;
          disposalPromise = undefined;
        }
      })();
      return disposalPromise;
    },
  };
}

function policyDriverFailure(code: DiscoveryPolicyOutcomeCode) {
  return {
    ok: false as const,
    code,
    summary: DISCOVERY_POLICY_SUMMARIES[code],
    recoverable: true,
  };
}

function isDiscoveryPolicyOutcomeCode(value: string): value is DiscoveryPolicyOutcomeCode {
  return Object.hasOwn(DISCOVERY_POLICY_SUMMARIES, value);
}
