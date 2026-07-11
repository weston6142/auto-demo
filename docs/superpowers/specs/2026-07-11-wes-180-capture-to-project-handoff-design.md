# WES-180 Capture-To-Project Handoff Design

Date: 2026-07-11

## Overview

WES-180 completes the Script-To-Recorded-Demo Workflow after WES-179. It adds a JSON-only `autodemo agent handoff` command that consumes a successful immutable execution result, imports its completed capture bundle into a new Auto Demo project, generates and saves the deterministic baseline polish variant, and returns structured editor and export next steps.

The handoff is a separate resumable operation. A capture that already succeeded does not need to be recorded again if project creation or variant generation fails.

## Goals

- Accept only a successful WES-179 execution result with a completed capture.
- Reject missing execution files, malformed or unsuccessful execution results, missing capture artifacts, and invalid capture bundles with stable non-secret JSON errors.
- Import the completed bundle with the existing `createProjectFromCaptureBundle()` contract.
- Never overwrite or reuse a non-empty project directory.
- Generate and save exactly one `baseline-polish` variant through the existing polish and project APIs.
- Return the project manifest, saved variant, warnings, and machine-safe editor/export command arguments.
- Document the complete plan-to-execute-to-handoff-to-editor/export operator flow.
- Extend the real Playwright smoke path through project import and saved baseline validation.

## Non-Goals

- Combining capture and handoff into one transaction.
- Re-recording a browser walkthrough during retry.
- Overwriting, deleting, cleaning, or rolling back existing project directories.
- Automatically starting the long-lived editor or rendering an MP4 during handoff.
- Generating multiple styles or allowing a custom initial variant id.
- Adding hosted storage, background jobs, or cross-process orchestration.
- Changing capture, project, polish, editor, or render schemas.

## Approaches Considered

### Selected: Separate `agent handoff` Command

Add:

```bash
npm run autodemo -- agent handoff \
  --execution <execution-result.json> \
  --project <new-project-directory> \
  --name <project-name> \
  --json
```

The command validates the immutable execution result, checks capture artifacts, imports the capture, then invokes the established agent project workflow with baseline generation and persistence. This preserves WES-179's capture-only boundary, makes retries cheap, and composes already-tested public APIs.

### Alternative: Extend `agent execute` With Project Flags

`agent execute` could accept `--project` and `--name` and run handoff automatically. That is convenient for the happy path, but a generation failure would make a successful recording command exit unsuccessfully and require a special resume contract. It also couples browser lifecycle code to project and polish behavior.

### Alternative: Generalize `agent run` To Import Captures

The existing project-oriented command could accept an execution result or capture bundle. This reduces command count but gives `agent run` two different starting states and obscures the important rule that only completed WES-179 execution evidence may enter this workflow.

## Command Contract

The MVP command requires `--execution`, `--project`, `--name`, and `--json`. Unknown arguments, missing values, empty names, and missing JSON output return exit code 1 and structured errors. The command accepts the wrapper object emitted by `agent execute` and does not accept a raw capture directory because WES-180 must preserve the executed-script provenance boundary.

Operators persist execute output and hand it off:

```bash
npm run autodemo -- agent execute \
  --plan approved-plan.json \
  --out .autodemo/capture \
  --json > .autodemo/execution.json

npm run autodemo -- agent handoff \
  --execution .autodemo/execution.json \
  --project ./my-demo \
  --name "My Demo" \
  --json
```

The project path may be missing or an existing empty directory. A file or non-empty directory is a collision. The command has no overwrite flag; operators choose a fresh directory when a prior project exists.

## Selected Architecture

The implementation belongs in a focused CLI adapter because all required capabilities already have public package APIs:

1. `@auto-demo/agent` supplies the WES-179 execution-result contract consumed structurally by the CLI boundary.
2. `@auto-demo/capture` supplies capture-bundle validation through the project importer.
3. `@auto-demo/project` supplies `createProjectFromCaptureBundle()`, `savePolishVariant()`, and final load/validation.
4. `@auto-demo/polish` supplies `generateBaselinePolishVariant()` for the initial project variant.

`packages/cli/src/agentHandoffCommand.ts` owns argument parsing, safe execution-result decoding, artifact presence checks, orchestration, error mapping, and JSON serialization. `packages/cli/src/index.ts` only routes `agent handoff` and exposes concise help text.

Dependencies for import, project workflow, and filesystem checks are injectable in focused tests. Production uses the public package functions. Tests observe results and files rather than private call order.

## Execution Validation

Before creating the project, the command requires:

- top-level `ok: true`;
- `plan.state: "executed"`;
- `plan.execution.status: "completed"`;
- a non-empty capture output directory and manifest path;
- media and metadata paths in the completed capture result;
- the manifest, media, and metadata files to exist as regular files.

The command uses the capture output directory as the importer input. It never forwards raw JSON parse failures, filesystem exception text, capture payloads, typed values, URLs, or local file contents in errors.

An unsuccessful or incomplete execution returns `invalid_execution_result`. A required path absent from the successful result or absent on disk returns `missing_capture_artifact`. A present bundle that fails the established capture validator returns `invalid_capture_bundle` through import error mapping.

## Project And Variant Flow

After preflight:

1. Call `createProjectFromCaptureBundle()` with the capture output directory, requested project directory, trimmed project name, and the CLI clock.
2. If import succeeds, call `generateBaselinePolishVariant()` with the imported project.
3. Save that result with `savePolishVariant()`; its existing revalidation remains authoritative.
4. Return the imported manifest and generated saved variant.

Import validates the collision before writing. If unexpected I/O interrupts import, existing project-package behavior may leave diagnostic partial files. If generation fails after import, the imported project remains available for inspection and retry; the command does not delete user data.

## Success Result

Success returns exit code 0 and JSON shaped as:

```ts
type AgentHandoffSuccess = {
  ok: true;
  execution: {
    captureDir: string;
    manifestPath: string;
  };
  project: {
    projectDir: string;
    manifestPath: string;
    name: string;
  };
  variant: {
    id: "baseline-polish";
    path: "variants/baseline-polish.json";
  };
  warnings: Array<{ code: string; message: string }>;
  nextSteps: {
    editor: { command: "npm"; args: string[] };
    export: { command: "npm"; args: string[] };
  };
};
```

The structured command plus argument arrays avoid unsafe shell quoting. The editor arguments invoke `npm run autodemo -- open --project <project-dir>`. The export arguments invoke `npm run autodemo -- export --project <project-dir> --variant baseline-polish --json`.

## Error Model

Expected failures return exit code 1, empty stderr in JSON mode, and `{ ok: false, errors }`. Stable codes are:

- `missing_execution_file`;
- `invalid_execution_json`;
- `invalid_execution_result`;
- `missing_capture_artifact`;
- `invalid_project_input`;
- `project_directory_collision`;
- `invalid_capture_bundle`;
- `generation_failed`;
- `unknown_agent_argument`.

Project import validation errors are mapped to this smaller handoff vocabulary while retaining safe messages. Agent workflow generation failures become `generation_failed`. Unexpected exceptions are sanitized to the closest phase-specific code; no stack or raw dependency error reaches normal JSON output.

## Testing Strategy

Behavior-first tests cover:

- a completed execution fixture creates a loadable project with `variants/baseline-polish.json`, a manifest entry for the same variant, and editor/export next-step arguments;
- malformed, failed, and incomplete execution results do not create a project;
- missing manifest, media, or metadata returns `missing_capture_artifact`;
- a present but invalid capture returns `invalid_capture_bundle`;
- a non-empty target directory returns `project_directory_collision` without changing its contents;
- generation failure returns a stable error and preserves the imported project;
- execution and handoff source files remain unchanged;
- the existing real Playwright execution smoke continues through handoff, `loadProject()`, and saved baseline verification.

Tests assert public JSON, exit codes, persisted files, load/validation behavior, and source immutability. They do not assert helper calls, internal parsing order, or private orchestration mechanics.

## Documentation

Update the root README, `packages/agent/README.md`, and the Codex/Claude wrapper guidance and fixtures with the two-command execute/handoff sequence, project collision rule, retry behavior, structured next steps, and the guarantee that handoff does not open the editor or export automatically.

Update the Linear project map with WES-180 implementation and verification evidence during the completion gate. When WES-180 is complete, reconcile and complete tracker WES-176 because all child issues and the final-project acceptance criterion will be satisfied.

## Conservative Decisions Applied

- No visual companion is needed because the work is a CLI orchestration and artifact contract with no visual design choices.
- The separate resumable handoff command is preferred over changing successful capture semantics.
- No overwrite flag is added; destructive replacement is outside MVP scope.
- The existing deterministic baseline is the only generated variant.
- Editor and export are returned as next steps, not run as side effects.
- TDD revealed that `runAgentWorkflow()` expects an existing source variant and therefore cannot bootstrap a freshly imported zero-variant project; the final design composes the lower-level public generation and persistence APIs directly.

## Spec Self-Review

- Placeholder scan: no placeholder markers or incomplete sections remain.
- Consistency: the command uses established capture import, baseline generation, variant persistence, editor, and export contracts without changing their ownership.
- Scope: one CLI orchestration adapter, focused tests, one extended smoke path, and documentation fit one implementation cycle.
- Ambiguity: command arguments, accepted execution evidence, collision behavior, persistence behavior, result shape, error codes, and deferred behavior are explicit.
