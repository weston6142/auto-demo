# Codex Walkthrough Refinement

> Legacy migration example: this transcript refines an existing
> `deterministic-v1` artifact. New walkthrough plans come from evidence-backed
> discovery compilation and use the discovery replay/repair path.

## Blocked review

Codex reviews a validated plan and explains one ambiguity: validation found two visible Get started buttons.

> Which target should the walkthrough use: the first button in the header or the second button in the main signup panel?

## User answer

> Use the second button in the main signup panel.

Codex converts that answer into a structured refinement artifact rather than editing plan JSON directly:

```json
[
  {
    "kind": "select-candidate",
    "stepId": "step-1",
    "blockerId": "blocker-1",
    "candidateId": "candidate-2"
  }
]
```

Codex runs:

```bash
npm run autodemo -- agent refine --plan plans/signup.blocked.json --refinements plans/signup.refinements.json --json
```

For this legacy migration artifact, the command applies the refinement,
invalidates any prior approval, and automatically revalidates the
`validate-first` plan.

## Revalidated plan artifact

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
    "state": "validated",
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
          "role": "button",
          "occurrence": 2
        }
      }
    ],
    "questions": [],
    "approvals": {
      "required": true,
      "approved": false
    },
    "execution": {
      "status": "not-started"
    },
    "warnings": [],
    "validation": {
      "status": "ready",
      "validatedAt": "2026-07-10T15:00:00.000Z",
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
  },
  "review": {
    "planId": "plan-signup",
    "source": "deterministic-v1",
    "target": "https://example.com/signup",
    "mode": "validate-first",
    "state": "validated",
    "steps": [
      {
        "id": "step-1",
        "order": 1,
        "action": "click",
        "summary": "Click Get started."
      }
    ],
    "warnings": [],
    "questions": [],
    "validation": {
      "status": "ready",
      "validatedAt": "2026-07-10T15:00:00.000Z",
      "mode": "dry-run",
      "checks": [
        {
          "id": "check-1",
          "stepId": "step-1",
          "action": "click",
          "status": "passed",
          "summary": "Validated: Click Get started."
        }
      ]
    },
    "blockers": [],
    "approval": {
      "eligible": true,
      "basis": "validated"
    },
    "summary": "Target: https://example.com/signup\nSource: deterministic-v1\nMode: validate-first\nState: validated\nSteps:\n1. Click Get started.\nValidation: ready\nValidation checks:\n- step-1: passed — Validated: Click Get started.\nReady for approval."
  }
}
```

Codex presents the revalidated plan again and asks for explicit approval in a later turn.
