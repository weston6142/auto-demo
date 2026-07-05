# WES-157 Local Browser Editor Project Loading Design

Date: 2026-07-04

## Summary

WES-157 creates the first usable Browser Editor entry point. Operators can run `autodemo open --project <project-dir-or-manifest>` to start a local HTTP server, receive a local URL, and load an Auto Demo project into a simple browser review UI. The UI focuses on project and variant inspection only; timeline controls, editing, rendering, export, hosted deployment, and agent wrappers remain deferred.

## Context

The repo already has the project contract needed by this task:

- `@auto-demo/project` validates and loads project directories or direct `autodemo.project.json` paths.
- Project manifests include saved `variants[]`, and validation verifies the matching `variants/<id>.json` files.
- `autodemo generate --json --save <variant-id|all>` can create saved variants for the editor to inspect.
- Before WES-157 implementation, `@auto-demo/editor` existed only as a package placeholder.
- Before WES-157 implementation, `autodemo open` was listed in the command surface but reported that it was not implemented.

The Linear acceptance criteria require documented startup, operator-readable validation errors, visible variant listing, and an empty/missing variant state that points the user back to generation or save mode.

## Product Decisions

Three approaches were considered:

1. Build a full frontend app with a framework and bundler.
   This gives richer UI foundations but adds dependency and packaging decisions before the editor behavior is known.
2. Serve a small static HTML app from the editor package.
   This satisfies WES-157 with minimal dependencies and keeps all loading behavior server-side through existing project APIs.
3. Add only a JSON API and leave UI to a later issue.
   This would help tests but misses the local browser review outcome.

Use approach 2. The editor package will expose a Node HTTP server that serves one static HTML page plus JSON endpoints backed by `loadProject()`. This keeps the first Browser Editor slice small, testable, and compatible with the existing npm workspace.

## Command Contract

`autodemo open --project <project-dir-or-manifest> [--host <host>] [--port <port>] [--no-browser]`

Behavior:

- `--project` is required and accepts the same directory or manifest path shape as `loadProject()`.
- `--host` defaults to `127.0.0.1`.
- `--port` defaults to `0`, allowing the OS to choose an available local port.
- `--no-browser` is accepted now as a no-op compatibility flag so automated runs can avoid future browser-launch behavior. WES-157 does not auto-open a browser.
- On successful startup, stdout prints `Auto Demo editor: http://host:port/`.
- Invalid arguments fail before starting a server with concise stderr.
- The command is async-only, matching `capture`, `validate`, and `generate`.

## Editor Server Contract

`@auto-demo/editor` exports:

- `startEditorServer(options): Promise<EditorServer>`
- `loadEditorProject(projectPath): Promise<EditorProjectLoadResult>`

`EditorServer` includes:

- `url`: local URL shown to operators.
- `close()`: shuts down the server for tests and future integrations.

HTTP behavior:

- `GET /` returns the HTML editor shell.
- `GET /api/project` loads the configured project and returns JSON with `200` for valid projects and `422` for project validation failures.
- Non-GET requests return `405`.
- Any other path returns `404`.

Project API success shape:

```json
{
  "ok": true,
  "project": {
    "name": "Checkout flow demo",
    "projectDir": "/path/to/project",
    "manifestPath": "/path/to/project/autodemo.project.json",
    "source": {
      "url": "https://example.com/checkout",
      "status": "completed",
      "durationMs": 6000,
      "viewport": { "width": 1280, "height": 720 }
    },
    "variants": [
      {
        "id": "baseline-polish",
        "displayName": "Baseline Polish",
        "timeline": { "startMs": 1500, "endMs": 2750 },
        "style": { "background": "solid", "frame": "browser" },
        "exportIntent": { "format": "mp4", "quality": "demo", "aspectRatio": "16:9" }
      }
    ]
  }
}
```

Project API failure shape:

```json
{
  "ok": false,
  "projectPath": "/path/to/input",
  "errors": [
    {
      "code": "missing_project_manifest",
      "message": "Auto Demo project manifest is missing."
    }
  ]
}
```

The API does not echo raw manifest JSON, event contents, typed values, command arguments, or secret-bearing source URL components. It only forwards the already sanitized manifest source URL and stable validation messages.

## Browser UI

The first UI is a static, dependency-free HTML page designed for repeated local review:

- Header shows the project name and source status when loading succeeds.
- Project summary shows source URL, capture duration, viewport, and project directory. The JSON API also includes `manifestPath` for integrations.
- Variant list shows each saved/generated variant's display name, id, timeline range, style frame/background, and export intent.
- Empty variant state says no saved variants were found and points to `autodemo generate --project <project> --json --save all`.
- Validation failure state shows "Project could not be loaded" and a list of stable error messages.
- Loading and network failure states are visible instead of silent.

No editing controls are introduced in WES-157. WES-170 later scoped WES-158 to approximate browser review fidelity with schema-backed timeline preview and finishing controls.

## Testing

Behavior-first tests will cover:

- `loadEditorProject()` returns sanitized project summary and variant cards for a valid project with saved variants.
- `loadEditorProject()` returns operator-readable validation errors for a missing or invalid project.
- `startEditorServer()` serves HTML and project JSON.
- `runCliAsync(["open", "--project", projectDir, "--no-browser"])` starts the editor through injected dependencies and prints a local URL.
- `runCli(["open"])` reports that open requires async execution, preserving synchronous CLI routing.
- README and package README document the command.

Tests should use real temporary project files and `@auto-demo/project` validation behavior. They should not assert private server internals or implementation helper calls.

## Deferrals

- Browser auto-launch.
- Approximate timeline preview and schema-backed finishing controls, now scoped to WES-158 by WES-170.
- Edited-variant persistence and save behavior, owned by WES-159.
- Export rendering.
- Hosted deployment.
- Agent-facing wrappers.
- Multi-project sessions or file-picker UI.
