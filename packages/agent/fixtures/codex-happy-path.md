# Codex Happy Path Transcript

This fixture shows Codex using the WES-160 agent workflow contract to select an
existing saved variant without reading project internals.

## Transcript

Codex runs:

```bash
autodemo agent run --project projects/checkout --json --variant baseline-polish
```

Codex reads the JSON handoff:

```json
{
  "ok": true,
  "project": {
    "projectPath": "projects/checkout",
    "manifestPath": "projects/checkout/autodemo.project.json",
    "name": "Checkout flow demo"
  },
  "variant": {
    "id": "baseline-polish",
    "path": "variants/baseline-polish.json",
    "source": "selected"
  },
  "artifacts": [
    {
      "kind": "project-manifest",
      "path": "projects/checkout/autodemo.project.json"
    },
    {
      "kind": "variant",
      "path": "variants/baseline-polish.json"
    }
  ],
  "warnings": [],
  "nextSteps": ["open-editor", "export-variant"]
}
```

Codex reports that the project is valid, `baseline-polish` is the selected saved
variant, `variants/baseline-polish.json` is the variant artifact, and export is
only a later handoff boundary until MP4 rendering exists.
