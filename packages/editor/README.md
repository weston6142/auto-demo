# @auto-demo/editor

Hosts the local browser editor for reviewing and finishing Auto Demo projects.

The editor provides the local Browser Editor slices from WES-157, WES-158, and WES-159:

- `loadEditorProject(projectPath)` returns a compact project summary with source metadata, manifest/project paths, saved/generated variants, and an empty-variant guidance message when no variants are saved.
- Saved variant summaries include the schema-backed source, timeline, viewport, caption, callout, cursor, click, style, and export intent fields needed for local finishing.
- Invalid projects return `{ ok: false, projectPath, errors }` using the stable `@auto-demo/project` validation errors.
- `startEditorServer({ projectPath, host, port })` starts a local HTTP server. `host` defaults to `127.0.0.1`; `port` defaults to `0` for OS port assignment.
- `GET /` serves the static editor shell.
- `GET /api/project` validates and loads the configured project through `@auto-demo/project`, returning `200` for valid projects and `422` for validation failures.
- `POST /api/variants` accepts JSON update/copy save requests for one complete draft variant, writes through `@auto-demo/project`, and returns a concise save summary.
- `GET /project-file/<project-relative-path>` serves whitelisted source media or event metadata files needed by the preview, including byte ranges for browser video playback.
- Unsupported methods return `405`; unknown paths return `404`.
- Valid projects show source metadata, saved/generated variants, an approximate preview, local draft controls for trim, viewport, captions, callouts, cursor/click emphasis, and direct style fields, and save controls for updating the selected variant or saving a named copy.
- Invalid projects show stable operator-readable validation errors.
- Projects without saved variants point operators to `autodemo generate --project <project> --json --save all`.

Run the editor through the CLI:

```bash
autodemo open --project <project-dir-or-manifest> [--host 127.0.0.1] [--port 0] [--no-browser]
```

`--no-browser` is currently a no-op compatibility flag; this slice prints the local URL but does not auto-open a browser.

The preview intentionally uses approximate browser review fidelity. Successful update/copy saves refresh from `/api/project` so the saved variant is immediately selectable. Agent handoffs can start the same local editor through `autodemo agent run --project <project-dir-or-manifest> --open-editor --json`. Exact export parity, named preset pickers, export rendering, browser auto-launch, autosave, hosted sync, and hosted deployment remain deferred.
