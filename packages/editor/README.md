# @auto-demo/editor

Hosts the local browser editor for reviewing and finishing Auto Demo projects.

WES-157 provides the first review-only editor slice:

- `loadEditorProject(projectPath)` returns a compact project summary with source metadata, manifest/project paths, saved variant cards, and an empty-variant guidance message when no variants are saved.
- Invalid projects return `{ ok: false, projectPath, errors }` using the stable `@auto-demo/project` validation errors.
- `startEditorServer({ projectPath, host, port })` starts a local HTTP server. `host` defaults to `127.0.0.1`; `port` defaults to `0` for OS port assignment.
- `GET /` serves the static editor shell.
- `GET /api/project` validates and loads the configured project through `@auto-demo/project`, returning `200` for valid projects and `422` for validation failures.
- Non-GET requests return `405`; unknown paths return `404`.
- Valid projects show source metadata and saved/generated variants.
- Invalid projects show stable operator-readable validation errors.
- Projects without saved variants point operators to `autodemo generate --project <project> --json --save all`.

Run the editor through the CLI:

```bash
autodemo open --project <project-dir-or-manifest> [--host 127.0.0.1] [--port 0] [--no-browser]
```

`--no-browser` is currently a no-op compatibility flag; this slice prints the local URL but does not auto-open a browser.

WES-170 chose approximate browser review fidelity for WES-158. The next editor slice should add schema-backed trim, viewport, caption/callout, cursor/click, and direct style controls while deferring exact export parity, named preset pickers, export rendering, browser auto-launch, and hosted deployment.
