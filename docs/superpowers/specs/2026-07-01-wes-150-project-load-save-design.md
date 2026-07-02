# WES-150 Project Load/Save Design

Date: 2026-07-01

## Linear Issue

- Issue: WES-150, "Project load/save and file validation behavior"
- Project: Auto Demo Balanced MVP
- Milestone: Demo Project Format
- Parent: WES-134, "Milestone 3: Demo Project Format tracker"

## Context

WES-148 made `@auto-demo/project` the owner of schema v1 `autodemo.project.json`
validation. WES-149 imports a WES-147 capture bundle into the normalized project layout:

```text
project-dir/
  autodemo.project.json
  raw/capture.webm
  metadata/events.jsonl
  metadata/capture.manifest.json
  variants/
  previews/
  exports/
```

WES-150 finishes the first project-format slice by making existing project directories
readable, validateable, and writable through package APIs. Later CLI, polish, editor, and
render work need one stable way to resolve the project root, parse the manifest, verify
referenced files, load a project, and save a changed manifest.

## Goals

- Add `validateProject()` for project directories or direct `autodemo.project.json` paths.
- Add `loadProject()` that returns project root, manifest path, and parsed manifest.
- Add `saveProject()` that writes formatted JSON atomically and revalidates the saved
  project.
- Return structured, non-secret validation errors for expected invalid project state.
- Check required schema v1 referenced files: viewport media, events metadata, and copied
  capture summary manifest.
- Keep tests behavior-oriented through filesystem fixtures and public API outcomes.

## Non-Goals

- Add or broaden `autodemo validate` for final project directories.
- Add migrations, conflict/revision handling, locking, or concurrent save behavior.
- Validate future variant, preview, or export file contents.
- Copy, delete, or mutate referenced artifact files during save.
- Preserve invalid manifests by partially saving them.

## Approaches Considered

### Recommended: Package-Owned Load/Save With Manifest Reuse

`@auto-demo/project` adds filesystem APIs around the existing manifest validator. The
public project validator resolves directory-or-manifest input, reads and parses JSON,
delegates schema checks to `validateProjectManifest()`, then checks the files required by
schema v1. `loadProject()` is a thin success-oriented wrapper over validation.
`saveProject()` validates the manifest object, writes `autodemo.project.json` through a
temp file and rename, then calls `validateProject()` so missing referenced files are still
reported.

This keeps the schema contract in one place and gives downstream packages a stable,
testable project boundary without adding CLI scope.

### Alternative: Add CLI Validation Now

The existing `autodemo validate` command could learn final project directories in the same
issue. That is useful later, but Linear explicitly keeps final project CLI support out of
WES-150. Adding it now would expand routing, output, and command tests beyond the package
API needed by downstream milestones.

### Alternative: Save Without Revalidating Files

`saveProject()` could validate only the manifest object before writing. That would be
faster and simpler, but it would let downstream code treat a saved project as usable even
when required artifacts are missing. Revalidating the saved project matches the issue
acceptance criteria and keeps save semantics honest.

## Public API

`@auto-demo/project` exports these additional types and functions:

```ts
export type ProjectValidationErrorCode =
  | "unsupported_project_version"
  | "invalid_project_manifest"
  | "unsafe_project_path"
  | "missing_project_manifest"
  | "invalid_project_json"
  | "missing_project_file";

export type LoadedProject = {
  projectDir: string;
  manifestPath: string;
  manifest: ProjectManifest;
};

export type ProjectValidationResult =
  | ({ ok: true } & LoadedProject)
  | {
      ok: false;
      projectDir: string;
      manifestPath: string;
      errors: ProjectValidationError[];
    };

export type SaveProjectInput = LoadedProject;

export function validateProject(projectDirOrManifest: string): Promise<ProjectValidationResult>;
export function loadProject(projectDirOrManifest: string): Promise<ProjectValidationResult>;
export function saveProject(project: SaveProjectInput): Promise<ProjectValidationResult>;
```

`ProjectManifestValidationResult` remains the pure manifest-only result from WES-148.

## Validation Behavior

Input path resolution accepts either:

- a project directory, resolved to `<projectDir>/autodemo.project.json`;
- a direct manifest path whose basename is `autodemo.project.json`, resolved to its parent
  directory.

Missing manifests return `missing_project_manifest`. Malformed JSON returns
`invalid_project_json`. Parsed JSON is passed to `validateProjectManifest()`, and those
structured errors are surfaced unchanged.

When manifest validation succeeds, `validateProject()` checks these project-relative paths:

- `manifest.media.primary.path`, currently `raw/capture.webm`;
- `manifest.metadata.events.path`, currently `metadata/events.jsonl`;
- `manifest.sourceCapture.manifestPath`, currently `metadata/capture.manifest.json`.

If any required file is absent or resolves to a directory, validation returns
`missing_project_file`. Messages identify the manifest field, not secret-bearing input
values. Unexpected filesystem failures other than missing files may throw.

## Load Behavior

`loadProject()` calls `validateProject()` and returns the same result shape. On success it
provides a stable `projectDir`, `manifestPath`, and `manifest` object. On expected invalid
input it returns structured errors instead of throwing.

## Save Behavior

`saveProject()` first validates `project.manifest` with `validateProjectManifest()`. If the
manifest object is invalid, it returns those errors without writing. If valid, it writes
formatted JSON to `project.manifestPath` through a temp-file-then-rename in the same
directory, then returns `validateProject(project.manifestPath)`.

Save does not create, copy, delete, or repair artifact files. A saved manifest with missing
referenced files therefore returns `missing_project_file` after the write, which makes the
observable project state explicit for callers.

## Error Handling And Hygiene

Expected invalid user/project input returns structured results. Error messages are stable
and do not echo raw manifest JSON, URL query strings, file contents, environment values, or
user-controlled path strings. Permission errors, disk failures, and unexpected filesystem
races may throw.

## Testing

Tests use temporary filesystem fixtures and public APIs:

- a WES-149 imported project validates and loads successfully from both directory and
  direct manifest path;
- missing `autodemo.project.json` returns `missing_project_manifest`;
- invalid JSON returns `invalid_project_json`;
- manifest validation errors keep their WES-148 codes;
- missing media, events, and capture summary files return `missing_project_file`;
- save writes formatted JSON, revalidates, and preserves referenced artifacts;
- invalid save input returns structured errors without overwriting the existing manifest.

## Project Map Updates

After implementation, update `docs/linear/auto-demo-project-structure.md` with WES-150
completion evidence, verification commands, and the next-task pointer into Auto Polish
Engine if WES-134 completion criteria are satisfied.
