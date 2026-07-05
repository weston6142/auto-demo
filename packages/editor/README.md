# @auto-demo/editor

Hosts the local browser editor for reviewing and finishing Auto Demo projects.

The editor provides the local Browser Editor slices from WES-157 and WES-158:

- `loadEditorProject(projectPath)` returns a compact project summary with source metadata, manifest/project paths, saved variant cards, and an empty-variant guidance message when no variants are saved.
- Saved variant summaries include the schema-backed source, timeline, viewport, caption, callout, cursor, click, style, and export intent fields needed for local finishing.
- Invalid projects return `{ ok: false, projectPath, errors }` using the stable `@auto-demo/project` validation errors.
- `startEditorServer({ projectPath, host, port })` starts a local HTTP server. `host` defaults to `127.0.0.1`; `port` defaults to `0` for OS port assignment.
- `GET /` serves the static editor shell.
- `GET /api/project` validates and loads the configured project through `@auto-demo/project`, returning `200` for valid projects and `422` for validation failures.
- `GET /project-file/<project-relative-path>` serves whitelisted source media or metadata files needed by the preview.
- Non-GET requests return `405`; unknown paths return `404`.
- Valid projects show source metadata, saved/generated variants, an approximate preview, and local draft controls for trim, viewport, captions, callouts, cursor/click emphasis, and direct style fields.
- Invalid projects show stable operator-readable validation errors.
- Projects without saved variants point operators to `autodemo generate --project <project> --json --save all`.

Run the editor through the CLI:

```bash
autodemo open --project <project-dir-or-manifest> [--host 127.0.0.1] [--port 0] [--no-browser]
```

`--no-browser` is currently a no-op compatibility flag; this slice prints the local URL but does not auto-open a browser.

The preview intentionally uses approximate browser review fidelity. Draft changes stay in browser state and the edited variant JSON panel until WES-159 adds persistence. Exact export parity, named preset pickers, export rendering, browser auto-launch, and hosted deployment remain deferred.
