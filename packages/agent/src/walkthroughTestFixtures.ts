import { createHash } from "node:crypto";
import type { WalkthroughPlan, WalkthroughPlanMode, WalkthroughPlanStep } from "./index.js";

type LegacyStepFixture = Omit<WalkthroughPlanStep, "id" | "order" | "questionId"> & {
  questionPrompt?: string;
};

const click = (sourceText: string): LegacyStepFixture => ({
  action: "click",
  resolution: "resolved",
  sourceText,
  public: { summary: sourceText },
});
const assertion = (sourceText: string): LegacyStepFixture => ({
  action: "assert",
  resolution: "resolved",
  sourceText,
  public: { summary: sourceText },
});
const typed = (sourceText: string): LegacyStepFixture => ({
  action: "type",
  resolution: "resolved",
  sourceText,
  public: { summary: sourceText },
});
const wait = (sourceText: string, waitDurationMs: number): LegacyStepFixture => ({
  action: "wait",
  resolution: "resolved",
  sourceText,
  public: { summary: sourceText },
  waitDurationMs,
});
const navigate = (sourceText: string, navigationUrl?: string): LegacyStepFixture => ({
  action: "navigate",
  resolution: "resolved",
  sourceText,
  public: { summary: sourceText },
  ...(navigationUrl === undefined ? {} : { navigationUrl }),
});
const question = (sourceText: string): LegacyStepFixture => ({
  action: "question",
  resolution: "unresolved",
  sourceText,
  public: { summary: `Clarify how to perform: ${sourceText}` },
  questionPrompt: `Clarify how to perform: ${sourceText}`,
});

const LEGACY_ARTIFACT_STEPS: Record<string, LegacyStepFixture[]> = {
  "Click Get started.": [click("Click Get started.")],
  "Verify Results.": [assertion("Verify Results.")],
  "Verify Ready.": [assertion("Verify Ready.")],
  "Verify destination.": [assertion("Verify destination.")],
  "Click Get started. Verify Results.": [click("Click Get started."), assertion("Verify Results.")],
  "Go to https://example.com/signup. Click Get started.": [
    navigate("Go to https://example.com/signup.", "https://example.com/signup"),
    click("Click Get started."),
  ],
  "Pick the best option.": [question("Pick the best option.")],
  "Type launch demo into Search.": [typed("Type [redacted] into Search.")],
  "Type launch demo into Search. Verify Results.": [
    typed("Type [redacted] into Search."),
    assertion("Verify Results."),
  ],
  "Type launch demo into Search. Wait 2 seconds.": [
    typed("Type [redacted] into Search."),
    wait("Wait 2 seconds.", 2_000),
  ],
  "Wait 2 seconds.": [wait("Wait 2 seconds.", 2_000)],
  "Go to https://example.com/dashboard.": [
    navigate("Go to https://example.com/dashboard.", "https://example.com/dashboard"),
  ],
  "Type alpha into Search. Type beta into Search.": [
    typed("Type [redacted] into Search."),
    typed("Type [redacted] into Search."),
  ],
  "Click Delete account. Type hunter2 into Password.": [
    click("Click Delete account."),
    typed("Type [redacted] into Password."),
  ],
  "Click Erase all data.": [click("Click Erase all data.")],
  "Click Continue.": [click("Click Continue.")],
  "Click Launch.": [click("Click Launch.")],
  "Click Load.": [click("Click Load.")],
  "Pick sk-live-secret.": [question("Pick sk-live-secret.")],
  "Go to https://example.com/signup. Click Get started. Verify pricing appears.": [
    navigate("Go to https://example.com/signup.", "https://example.com/signup"),
    click("Click Get started."),
    assertion("Verify pricing appears."),
  ],
  "Click Get started. Type hunter2 into the password field. Verify dashboard appears.": [
    click("Click Get started."),
    typed("Type [redacted] into the password field."),
    assertion("Verify dashboard appears."),
  ],
  "Open the dashboard. Pick the best option.": [
    navigate("Open the dashboard."),
    question("Pick the best option."),
  ],
  "Open the dashboard.": [navigate("Open the dashboard.")],
  "Pick the best option. Click Continue. Verify landing appears.": [
    question("Pick the best option."),
    click("Click Continue."),
    assertion("Verify landing appears."),
  ],
  "Pick the best option. Verify dashboard appears.": [
    question("Pick the best option."),
    assertion("Verify dashboard appears."),
  ],
  "Type hunter2 into Password.": [typed("Type [redacted] into Password.")],
  "Type hunter2 into the search field.": [typed("Type [redacted] into the search field.")],
  "Type hunter2 into the password field.": [typed("Type [redacted] into the password field.")],
  "Type safe-value into the search field.": [typed("Type [redacted] into the search field.")],
  "Type sensitive-value into the search field.": [typed("Type [redacted] into the search field.")],
  "Navigate to javascript:alert(1).": [navigate("Navigate to javascript:alert(1).")],
  "Go to https://example.com/start. Click Get started. Type launch demo into Search. Wait 1 second. Verify Results.":
    [
      navigate("Go to https://example.com/start.", "https://example.com/start"),
      click("Click Get started."),
      typed("Type [redacted] into Search."),
      wait("Wait 1 second.", 1_000),
      assertion("Verify Results."),
    ],
};

export function legacyWalkthroughPlanFixture(input: {
  targetUrl?: string;
  script: string;
  mode?: WalkthroughPlanMode;
}): WalkthroughPlan {
  const targetUrl = input.targetUrl ?? "https://example.com/signup";
  const mode = input.mode ?? "validate-first";
  const fixtureSteps = LEGACY_ARTIFACT_STEPS[input.script];
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
