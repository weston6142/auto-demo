# Codex Walkthrough Review And Approval

## User request

> Show me the validated signup walkthrough before recording it.

## Codex reviews the plan

Codex runs:

```bash
npm run autodemo -- agent review --plan plans/signup.validated.json --json
```

Codex explains the target, mode, ordered steps, assumptions, and validation result in conversation. It does not paste raw plan JSON or omit blockers.

## Codex asks for confirmation

> The plan is validated and ready. It will open the signup page, click Get started, and verify that pricing appears. Approve this exact plan for execution?

## User confirmation

> Yes, approve it.

Codex runs the approval command only after that explicit confirmation:

```bash
npm run autodemo -- agent approve --plan plans/signup.validated.json --json
```

## Approved plan artifact

```json
{
  "ok": true,
  "plan": {
    "id": "plan-signup",
    "target": {
      "kind": "browser",
      "url": "https://example.com/signup"
    },
    "mode": "validate-first",
    "state": "approved",
    "source": {
      "script": "Click Get started.",
      "parser": "deterministic-v1"
    },
    "steps": [
      {
        "id": "step-1",
        "order": 1,
        "action": "click",
        "resolution": "resolved",
        "sourceText": "Click Get started.",
        "public": {
          "summary": "Click Get started."
        },
        "targetHint": {
          "kind": "accessible",
          "label": "Get started",
          "role": "button"
        }
      }
    ],
    "questions": [],
    "approvals": {
      "required": true,
      "approved": true,
      "approvedAt": "2026-07-10T15:00:00.000Z",
      "planFingerprint": "sha256:a1d4d13b244b96040d9943f31df9687965428a0c39326730972d4dc53c228dce",
      "basis": "validated"
    },
    "execution": {
      "status": "not-started"
    },
    "warnings": [],
    "validation": {
      "status": "ready",
      "validatedAt": "2026-07-10T14:59:00.000Z",
      "mode": "dry-run",
      "checks": [
        {
          "id": "check-1",
          "stepId": "step-1",
          "action": "click",
          "status": "passed",
          "summary": "Validated: Click Get started."
        }
      ],
      "blockers": []
    }
  }
}
```

Codex persists the returned plan artifact for WES-179. It does not claim that the fingerprint proves user identity; it proves that execution content still matches the approved artifact.
