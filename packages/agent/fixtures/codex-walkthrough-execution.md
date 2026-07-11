# Codex Walkthrough Execution

Codex starts only from an approved plan artifact. It stores any type-step values
in a separate inputs file containing non-secret demo data and never repeats those
values in the conversation.

```bash
autodemo agent execute --plan <approved-plan-json-file> --inputs <runtime-inputs-json-file> --out <capture-directory> --json
```

Execution verifies the approval fingerprint, drives the recorded browser with
the deterministic `natural-v1` pacing profile, and leaves both input files
unchanged. There is no unapproved execution shortcut.

## Successful execution result

```json
{
  "ok": true,
  "phase": "completed",
  "plan": {
    "state": "executed",
    "execution": {
      "status": "completed",
      "pacingProfile": "natural-v1"
    }
  },
  "capture": {
    "outputDir": "captures/demo",
    "manifestPath": "captures/demo/capture.manifest.json",
    "mediaPath": "captures/demo/media/viewport.webm",
    "metadataPath": "captures/demo/metadata/events.jsonl"
  }
}
```

Codex saves this JSON as the execution result, then runs:

```bash
autodemo agent handoff --execution <execution-result-json-file> --project <new-project-directory> --name <project-name> --json
```

Handoff verifies the completed capture, creates a fresh project, and saves
`baseline-polish`. It does not overwrite a non-empty project directory. If
generation fails after import, Codex preserves the project and can resume
diagnosis without re-recording. On success it reports the structured
`autodemo open --project <new-project-directory>` and
`autodemo export --project <new-project-directory> --variant baseline-polish --json`
next steps without running either automatically.

## Failed execution result

```json
{
  "ok": false,
  "phase": "execution",
  "plan": {
    "state": "approved",
    "execution": {
      "status": "failed",
      "pacingProfile": "natural-v1"
    }
  },
  "errors": [
    {
      "code": "target_not_found",
      "stepId": "step-3",
      "message": "Walkthrough execution step failed."
    }
  ],
  "capture": {
    "manifestPath": "captures/demo/capture.manifest.json"
  }
}
```

Codex reports the stable error and failed capture bundle path. It does not paste
runtime inputs, raw DOM, selectors, raw event payloads, or manifest contents.
