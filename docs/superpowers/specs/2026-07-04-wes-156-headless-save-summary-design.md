# WES-156 Headless Save Summary Design

## Context

WES-155 made headless generation batch-shaped while keeping the MVP preset list
baseline-only. Before WES-156, `generateHeadlessVariants()` loaded a valid
project, required a persisted source variant, returned one deterministic
baseline summary, and rejected save modes as unsupported. WES-153 already owns
project persistence through `savePolishVariant(project, variant)`, which writes
`variants/<variant-id>.json`, updates `autodemo.project.json`, and reloads the
project.

WES-156 adds the first non-dry-run save path for headless generation. The goal is
not to render, export, rank styles, or add more style presets. The goal is to
persist requested generated variants and return a concise JSON summary that an
agent or automation log can trust.

## Requirements

- Support dry-run, selected save, and save-all modes in the headless API and CLI.
- Save generated variants through `savePolishVariant()` so raw capture media and
  event metadata remain untouched.
- Revalidate the project after each save and return structured errors for
  duplicate ids, unsafe generated ids/paths, invalid selected ids, invalid
  project state, and save/reload failures.
- Emit JSON with generated variants, saved variant ids and paths, skipped
  variants, validation status, and next-step hints for editor/export workflows.
- Keep tests behavior-oriented: assert public JSON/API effects and filesystem
  outputs, not private helper calls.

## Approach

Use a small save-mode model inside `@auto-demo/polish`:

- `dry-run`: default existing behavior, no writes.
- `selected`: save exactly one generated variant chosen by id.
- `all`: save all generated variants in the generated batch.

The CLI maps `--save <variant-id>` to selected mode and `--save all` to all mode.
`--dry-run` continues to mean no writes and cannot be combined with `--save`.
The MVP batch still contains only the deterministic baseline entry, but the save
summary is intentionally batch-shaped so future presets can reuse the same
contract.

## API Contract

Extend `HeadlessVariantGenerationOptions`:

```ts
type HeadlessVariantGenerationOptions = {
  projectPath: string;
  dryRun?: boolean;
  json?: boolean;
  count?: number;
  style?: string;
  styles?: string[];
  sourceVariantId?: string;
  save?: boolean;
  mode?: string;
  selectedVariantId?: string;
};
```

Normalize save input to one internal mode:

```ts
type HeadlessSaveRequest =
  { mode: "dry-run" } | { mode: "selected"; selectedVariantId: string } | { mode: "all" };
```

Successful results keep the existing project, request, variants, and errors
shape, and add a `summary` object:

```ts
summary: {
  mode: "dry-run" | "selected" | "all";
  saved: Array<{ id: string; path: string }>;
  skipped: Array<{ id: string; reason: "dry-run" | "not-selected" }>;
  validation: { ok: true; manifestPath: string };
  nextSteps: string[];
}
```

Each variant summary also keeps a per-variant `save` object:

```ts
save:
  | { mode: "dry-run"; saved: false }
  | { mode: "selected" | "all"; saved: true; path: string }
  | { mode: "selected"; saved: false; reason: "not-selected" };
```

Failures remain non-throwing and JSON-ready:

- `invalid_selected_variant`: selected id does not match a generated variant.
- `duplicate_variant_id`: the project already contains the generated variant id.
- `unsafe_variant_path`: generated id cannot be represented as
  `variants/<id>.json`.
- `invalid_project`: loading or save/reload validation failed.
- Existing errors remain for unsupported output, styles, counts, missing source
  variants, duplicate style requests, and malformed arguments.

## CLI Contract

Supported examples:

```sh
autodemo generate --project ./demo --dry-run --json
autodemo generate --project ./demo --json --save baseline-polish
autodemo generate --project ./demo --json --save all
```

Invalid examples return structured JSON errors:

```sh
autodemo generate --project ./demo --dry-run --json --save baseline-polish
autodemo generate --project ./demo --json --save missing-id
autodemo generate --project ./demo --json --save
```

The CLI remains JSON-only for WES-156. Non-JSON output remains deferred.

## Data Flow

1. Parse CLI arguments into headless generation options.
2. Normalize style/source/save requests.
3. Load and validate the project with `loadProject()`.
4. Confirm the source variant exists.
5. Generate the deterministic baseline `ProjectVariant`.
6. Validate the selected save target, if any.
7. For each variant selected for saving, call `savePolishVariant()` and use the
   returned loaded project as the next save input.
8. Return a JSON summary with saved paths, skipped variants, final validation,
   and next-step hints.

## Error Handling

Save-mode validation should happen before writes when possible. If a later save
or reload validation fails, return `ok: false` with structured errors and include
any successfully saved entries in the summary. Because the current MVP batch has
one generated variant, partial writes are mostly a future-proofing concern, but
the result shape should be ready for more generated variants.

Errors must not echo raw local file contents, secrets, typed browser values, or
full event payloads. Local project paths already appear in this CLI's JSON
contract and may continue to appear as project or variant artifact paths.

## Testing

Add API tests in `packages/polish/src/index.test.ts` for:

- selected save persists the generated variant and reloads the project;
- save all persists all generated variants and reports saved paths;
- invalid selected id returns `invalid_selected_variant` without writing a new
  variant file;
- duplicate generated id returns a structured duplicate error;
- dry-run keeps the existing no-write behavior and summary marks the generated
  variant skipped.

Add CLI tests in `packages/cli/src/index.test.ts` for:

- `--save baseline-polish` returns JSON with saved id/path and project validation
  status;
- `--save all` returns the all-mode summary;
- `--dry-run --save baseline-polish` returns a structured save-mode error;
- missing `--save` value returns a structured argument error.

Run focused package tests first, then package typecheck/build where relevant, and
finally `npm run validate`.

## Deferrals

- Rendering saved variants.
- Export bundle generation.
- Browser preview/editor behavior.
- Product ranking among multiple style presets.
- Non-JSON CLI output.
- Additional themed presets.
- On-disk run summary files.

## Self-Review

- Placeholder scan: no TBD/TODO placeholders remain.
- Consistency: the API, CLI examples, data flow, and tests all use the same
  dry-run, selected, and all save-mode vocabulary.
- Scope: the design is limited to one Headless Variant Generation issue and does
  not include rendering, editor, or export work.
- Ambiguity: `--save <id>` and `--save all` are explicitly chosen as the CLI
  contract; `--dry-run` and `--save` are mutually exclusive.
