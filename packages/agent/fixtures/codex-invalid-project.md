# Codex Invalid Project Transcript

This fixture shows Codex handling an expected project validation failure through
stable JSON errors.

## Transcript

Codex runs:

```bash
autodemo agent run --project projects/missing --json
```

Codex reads the JSON failure:

```json
{
  "ok": false,
  "project": {
    "projectPath": "projects/missing"
  },
  "errors": [
    {
      "code": "invalid_project",
      "message": "Auto Demo project is invalid.",
      "projectErrorCode": "missing_project_manifest"
    }
  ]
}
```

Codex reports the stable `invalid_project` code and the non-secret message. It
does not paste raw manifest contents, local credentials, browser metadata, typed
values, or secret-bearing paths into the task report.
