import { createHash } from "node:crypto";
import type { WalkthroughPlan, WalkthroughPlanMode, WalkthroughPlanStep } from "@auto-demo/agent";

export type LegacyStepFixture = Omit<WalkthroughPlanStep, "id" | "order" | "questionId"> & {
  questionPrompt?: string;
};

const LEGACY_ARTIFACT_STEPS: Record<string, LegacyStepFixture[]> = {
  "Click Get started.": [resolved("click", "Click Get started.")],
  "Pick the best option.": [question("Pick the best option.")],
  "Type hunter2 into the search field.": [
    resolved("type", "Type [redacted] into the search field."),
  ],
  "Type launch demo into Search. Verify Results.": [
    resolved("type", "Type [redacted] into Search."),
    resolved("assert", "Verify Results."),
  ],
};

export function legacyWalkthroughPlanFixture(input: {
  targetUrl?: string;
  script: string;
  mode?: WalkthroughPlanMode;
  steps?: LegacyStepFixture[];
}): WalkthroughPlan {
  const targetUrl = input.targetUrl ?? "https://example.com/signup";
  const mode = input.mode ?? "validate-first";
  const fixtureSteps = input.steps ?? LEGACY_ARTIFACT_STEPS[input.script];
  if (fixtureSteps === undefined) {
    throw new Error(`Missing explicit legacy artifact fixture: ${input.script}`);
  }

  const questions: WalkthroughPlan["questions"] = [];
  const steps = fixtureSteps.map((fixture, index): WalkthroughPlanStep => {
    const id = `step-${index + 1}`;
    if (fixture.action === "question") {
      const questionId = `question-${index + 1}`;
      questions.push({
        id: questionId,
        stepId: id,
        prompt: fixture.questionPrompt ?? fixture.public.summary,
        reason: "unrecognized_step",
      });
      const step = { ...fixture };
      delete step.questionPrompt;
      return { id, order: index + 1, ...step, questionId };
    }
    const step = { ...fixture };
    delete step.questionPrompt;
    return {
      id,
      order: index + 1,
      ...step,
      ...(step.action === "type" ? { inputBinding: id } : {}),
    };
  });
  const script = steps.map((step) => step.sourceText).join(" ");
  const id = createHash("sha256")
    .update(`${targetUrl}\n${mode}\n${script}`)
    .digest("hex")
    .slice(0, 12);

  return {
    id: `plan-${id}`,
    target: { kind: "browser", url: targetUrl },
    mode,
    state: questions.length === 0 ? "draft" : "needs-clarification",
    source: { parser: "deterministic-v1", script },
    steps,
    questions,
    approvals: { required: true, approved: false },
    execution: { status: "not-started" },
    warnings:
      mode === "best-guess"
        ? [
            {
              code: "best_guess_mode",
              message: "Best-guess mode may proceed without validation; review before execution.",
            },
          ]
        : [],
  };
}

export function resolved(
  action: Exclude<WalkthroughPlanStep["action"], "question">,
  sourceText: string,
  execution: Pick<WalkthroughPlanStep, "navigationUrl" | "waitDurationMs"> = {},
): LegacyStepFixture {
  return {
    action,
    resolution: "resolved",
    sourceText,
    public: { summary: sourceText },
    ...execution,
  };
}

function question(sourceText: string): LegacyStepFixture {
  return {
    action: "question",
    resolution: "unresolved",
    sourceText,
    public: { summary: `Clarify how to perform: ${sourceText}` },
    questionPrompt: `Clarify how to perform: ${sourceText}`,
  };
}
