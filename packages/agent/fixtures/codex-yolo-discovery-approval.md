# Codex YOLO Discovery And Approval Handoff

This synthetic transcript shows Codex turning a natural-language goal into a
replay-validated plan before asking for approval and recording. Paths are
relative, and no runtime values, secrets, raw DOM, selectors, screenshots, or
request data appear in the transcript.

## User Requests Discovery

> Use YOLO discovery on `https://example.test/profile` to figure out how to save
> a profile, then show me the plan before you record it.

Codex treats YOLO as permission to choose bounded discovery actions, not as
mutation authority or approval. It starts with safe exact-origin inspection and
recognizes that saving a profile may issue a non-idempotent request. That is a
hard policy boundary, so Codex stops before the mutation and asks the user to
identify a disposable environment and exact allowed origins.

## User Confirms Disposable Scope

> This `example.test` environment is disposable for this discovery run. Allow
> mutation only on `https://example.test`.

## Codex records fresh disposable authority

```json
{
  "policy": {
    "mode": "disposable",
    "acknowledgement": "environment-is-disposable",
    "allowedOrigins": ["https://example.test"]
  }
}
```

## Codex Performs Mutating Discovery

Codex now creates an isolated Playwright context with
`createPolicyEnforcedPlaywrightDiscoveryRehearsalController(...)` and the
freshly acknowledged exact-origin disposable policy.

Codex reads the first bounded observation and performs one structured action at
a time with declared expectations. An initial link reaches an unrelated profile
help page, so Codex records that branch, performs an explicit back action, and
tries the visible `Edit profile` target. It resolves the `profile-name` binding
in memory with non-secret demo data, saves, observes the success state, and
selects only the continuous successful attempts. The abandoned branch stays in
the completed root discovery session but not its selected path.

Codex compiles that session with
`compileDiscoverySessionToWalkthroughPlan()`. Before replaying the mutating save,
Codex reaches the replay policy boundary and asks for fresh confirmation that
the same exact origin is disposable for this replay run.

> I freshly confirm `https://example.test` is disposable for this bounded replay.

Codex creates a new disposable replay policy from that acknowledgement and
starts `replayAndRepairDiscoveryPlan()` in a fresh isolated browser. Neither the
discovery controller's permit nor its runtime policy state is reused.

## Replay asks Codex for a bounded repair

```json
{
  "ok": false,
  "phase": "replay",
  "attempts": [
    {
      "attempt": 1,
      "status": "failed",
      "failure": {
        "code": "target_not_found",
        "repairability": "repairable",
        "step": {
          "id": "step-edit-profile",
          "order": 2,
          "action": "click",
          "summary": "Open profile editing."
        },
        "observed": {
          "url": "https://example.test/profile"
        },
        "recommendation": "rediscover-target"
      }
    }
  ],
  "errors": [
    {
      "code": "replay_failed",
      "message": "Discovery replay requires bounded repair."
    }
  ]
}
```

Codex opens a new disposable exact-origin rehearsal under the freshly confirmed
replay scope, creates one completed direct-child session from that evidence, and
selects the repaired accessible target. It does not edit the plan. The repair
provider returns the child session, compilation runs again, and the second fresh
replay passes. At most two direct-child repairs are allowed. A hard policy
boundary would stop instead of entering this loop.

## Codex presents the replay-validated plan

```json
{
  "ok": true,
  "plan": {
    "id": "plan-profile-save",
    "state": "validated",
    "target": {
      "url": "https://example.test/profile"
    },
    "goal": "Save a demo profile",
    "validation": {
      "mode": "discovery-replay",
      "status": "ready",
      "replay": {
        "attempts": 2,
        "sourceSessionId": "discovery-profile-repair-1"
      }
    },
    "approvals": {
      "required": true,
      "approved": false
    },
    "orderedSteps": [
      "Open profile editing.",
      "Enter the profile-name demo binding.",
      "Save the profile.",
      "Confirm the saved profile state."
    ],
    "warnings": [],
    "blockers": []
  },
  "review": {
    "status": "ready-for-approval",
    "replayAttempts": 2
  }
}
```

Codex explains the target, ordered public steps, assertion, binding name,
assumptions, warnings, blockers, and replay count. It does not paste the raw
session, full plan artifact, or binding value. It now pauses for explicit
approval; the initial YOLO request did not approve this plan.

## User Explicitly Approves

> I approve that replay-validated plan. Record it and create the project.

Codex saves the reviewed validated artifact at
`workflow/profile-save.validated-plan.json`, then runs:

```bash
npm run autodemo -- agent approve --plan workflow/profile-save.validated-plan.json --json
```

The approval command returns a full approved plan artifact. This transcript
shows only its public summary.

## Approval command returns

```json
{
  "ok": true,
  "plan": {
    "id": "plan-profile-save",
    "state": "approved",
    "approvals": {
      "required": true,
      "approved": true,
      "basis": "validated"
    }
  }
}
```

Codex persists the unabridged returned artifact at
`workflow/profile-save.approved-plan.json`. It keeps non-secret runtime inputs in
a separate local file and does not repeat their values in conversation or
command arguments.

```bash
npm run autodemo -- agent execute --plan workflow/profile-save.approved-plan.json --inputs workflow/profile-save.inputs.json --out captures/profile-save --json
```

Codex writes the successful execute JSON to
`workflow/profile-save.execution.json`, then runs:

```bash
npm run autodemo -- agent handoff --execution workflow/profile-save.execution.json --project projects/profile-demo --name "Profile demo" --json
```

## Handoff command returns

```json
{
  "ok": true,
  "project": {
    "manifestPath": "projects/profile-demo/autodemo.project.json"
  },
  "variant": {
    "id": "baseline-polish",
    "path": "projects/profile-demo/variants/baseline-polish.json"
  },
  "nextSteps": ["open-editor", "export-variant"]
}
```

Final recording begins from the approved deterministic artifact in a new capture
context. The discovery page, policy permit, disposable acknowledgement, repair
authority, failed branches, and runtime values never carry into final capture.
