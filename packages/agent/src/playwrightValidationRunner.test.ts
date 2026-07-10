import { describe, expect, it } from "vitest";
import { createPlaywrightValidationRunner, createWalkthroughPlan } from "./index.js";

function step(script: string) {
  const result = createWalkthroughPlan({
    targetUrl: "https://example.com",
    script,
    mode: "validate-first",
  });
  if (!result.ok || result.plan.steps[0] === undefined) {
    throw new Error("test step should be valid");
  }
  return result.plan.steps[0];
}

describe("createPlaywrightValidationRunner", () => {
  it("returns each distinct visible element when accessible names are identical", async () => {
    const browser = createPlaywrightValidationRunner();
    await browser.open(
      "data:text/html,<button>Get%20started</button><button>Get%20started</button>",
    );

    try {
      const matches = await browser.findMatches(step("Click Get started."));

      expect(matches).toHaveLength(2);
      expect(new Set(matches.map((match) => match.id)).size).toBe(2);
      expect(matches).toEqual([
        {
          id: expect.any(String),
          label: "Get started (button 1 of 2)",
          role: "button",
          targetHint: {
            kind: "accessible",
            label: "Get started",
            role: "button",
            occurrence: 1,
          },
        },
        {
          id: expect.any(String),
          label: "Get started (button 2 of 2)",
          role: "button",
          targetHint: {
            kind: "accessible",
            label: "Get started",
            role: "button",
            occurrence: 2,
          },
        },
      ]);

      const selectedStep = step("Click Get started.");
      selectedStep.targetHint = {
        kind: "accessible",
        label: "Get started",
        role: "button",
        occurrence: 2,
      };
      await expect(browser.findMatches(selectedStep)).resolves.toEqual([
        expect.objectContaining({
          label: "Get started (button 2 of 2)",
          targetHint: selectedStep.targetHint,
        }),
      ]);
    } finally {
      await browser.close();
    }
  });

  it("matches a labeled field and fills only a synthetic redacted value", async () => {
    const browser = createPlaywrightValidationRunner();
    await browser.open(
      "data:text/html,<label>Password<input%20type=password%20name=password%20oninput='document.title=this.value'></label>",
    );

    try {
      const matches = await browser.findMatches(step("Type hunter2 into Password."));
      expect(matches).toHaveLength(1);

      await browser.type(matches[0], { redactedValue: true });
      const page = await browser.inspectPage();

      expect(page.title).toBe("typed value redacted");
      expect(page.authWall).toBe(false);
      expect(JSON.stringify(matches)).not.toContain("hunter2");
    } finally {
      await browser.close();
    }
  });

  it("recognizes a sign-in page as an auth wall", async () => {
    const browser = createPlaywrightValidationRunner();
    await browser.open(
      "data:text/html,<title>Sign%20in</title><h1>Sign%20in</h1><input%20type=password>",
    );

    try {
      await expect(browser.inspectPage()).resolves.toMatchObject({
        title: "Sign in",
        authWall: true,
      });
    } finally {
      await browser.close();
    }
  });

  it("marks implicit form-submit controls as potentially mutating", async () => {
    const browser = createPlaywrightValidationRunner();
    await browser.open("data:text/html,<form><button>Continue</button></form>");

    try {
      await expect(browser.findMatches(step("Click Continue."))).resolves.toEqual([
        {
          id: expect.any(String),
          label: "Continue",
          role: "button",
          actionRisk: "potentially-mutating",
          targetHint: {
            kind: "accessible",
            label: "Continue",
            role: "button",
          },
        },
      ]);
    } finally {
      await browser.close();
    }
  });

  it("blocks non-idempotent requests triggered by otherwise safe-looking controls", async () => {
    const browser = createPlaywrightValidationRunner();
    await browser.open(
      "data:text/html,<button%20onclick=\"fetch('https://example.com/mutate',{method:'POST'})\">Launch</button>",
    );

    try {
      const [button] = await browser.findMatches(step("Click Launch."));
      await browser.click(button);

      await expect(browser.waitForIdle()).rejects.toMatchObject({ code: "unsafe_action" });
    } finally {
      await browser.close();
    }
  });

  it("surfaces non-idempotent requests attempted during initial page load", async () => {
    const browser = createPlaywrightValidationRunner();
    await browser.open(
      "data:text/html,<script>fetch('https://example.com/mutate',{method:'POST'})</script><button>Launch</button>",
    );

    try {
      await expect(browser.inspectPage()).rejects.toMatchObject({ code: "unsafe_action" });
    } finally {
      await browser.close();
    }
  });

  it("blocks WebSocket connections triggered by controls", async () => {
    const browser = createPlaywrightValidationRunner();
    await browser.open(
      "data:text/html,<button%20onclick=\"new WebSocket('wss://example.com/socket')\">Launch</button>",
    );

    try {
      const [button] = await browser.findMatches(step("Click Launch."));
      await browser.click(button);

      await expect(browser.waitForIdle()).rejects.toMatchObject({ code: "unsafe_action" });
    } finally {
      await browser.close();
    }
  });

  it("waits for delayed SPA updates to settle after an action", async () => {
    const browser = createPlaywrightValidationRunner({ timeoutMs: 1200, stabilityMs: 400 });
    await browser.open(
      'data:text/html,<button%20onclick=\'setTimeout(()=>document.body.insertAdjacentHTML("beforeend","<div>Ready</div>"),300)\'>Load</button>',
    );

    try {
      const [button] = await browser.findMatches(step("Click Load."));
      await browser.click(button);
      await browser.waitForIdle();

      await expect(browser.findMatches(step("Verify Ready."))).resolves.toHaveLength(1);
    } finally {
      await browser.close();
    }
  });
});
