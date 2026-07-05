# @auto-demo/editor

Hosts the local browser editor for reviewing and finishing Auto Demo projects.

WES-157 provides the first review-only editor slice:

- `startEditorServer({ projectPath })` starts a local HTTP server.
- `GET /` serves the static editor shell.
- `GET /api/project` validates and loads the configured project through `@auto-demo/project`.
- Valid projects show source metadata and saved/generated variants.
- Invalid projects show stable operator-readable validation errors.
- Projects without saved variants point operators to `autodemo generate --project <project> --json --save all`.

Run the editor through the CLI:

```bash
autodemo open --project <project-dir-or-manifest> [--host 127.0.0.1] [--port 0] [--no-browser]
```

Timeline preview controls, variant editing, export rendering, browser auto-launch, and hosted deployment are planned follow-up work.
