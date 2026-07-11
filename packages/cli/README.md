# @auto-demo/cli

Provides the `autodemo` command and the repo-local command surface for capture,
generation, local editor handoff, agent workflow orchestration, walkthrough
plan intake, validation, and export.

## MVP Packaging Target

WES-168 selects one MVP packaging target: a **clean local checkout run path**.
The balanced MVP does not require registry publication, Homebrew, native
installers, or any standalone distribution artifact.

Supported environment:

- macOS
- Node 22.x
- npm 10
- Playwright Chromium installed through `npm run setup:browser`
- `ffmpeg` and `ffprobe` available on `PATH`

Expected repo-root setup flow:

```bash
npm install
npm run build
npm run setup:browser
```

The current clean-checkout operator and agent contract is:

```bash
npm run autodemo -- <subcommand...>
```

WES-164 provides this repo-root wrapper contract for the existing CLI surface.

The package-local fallback remains available for direct CLI workspace
diagnostics:

```bash
npm --workspace @auto-demo/cli run autodemo -- <subcommand...>
```

The logical `autodemo` subcommands stay the same:

- `capture`
- `generate`
- `open`
- `agent run`
- `agent plan`
- `agent validate`
- `export`
- `validate`

## Agent Plan Intake

`autodemo agent plan` turns a target browser URL and natural-language demo
script into deterministic JSON-ready walkthrough plan data:

```bash
npm run autodemo -- agent plan --url <target-url> --script <script-text> [--mode validate-first|best-guess] --json
```

The command currently requires `--json`. `--mode` defaults to `validate-first`;
`best-guess` preserves the same plan shape and adds a warning for review. Plans
contain draft or needs-clarification state, resolved navigate, click, type,
wait, and assert steps, unresolved questions for ambiguous instructions,
approval and execution placeholders, and public redaction for typed values.

The intake contract does not validate page state, approve plans, execute browser
actions, record captures, automate credentials, perform destructive production
actions, or create Auto Demo projects.

## Agent Walkthrough Validation

`autodemo agent validate` rehearses a walkthrough plan against browser page
state without recording a capture or creating an Auto Demo project:

```bash
npm run autodemo -- agent validate --plan <plan-json-file> --json
npm run autodemo -- agent validate --url <target-url> --script <script-text> --json
```

The command prints JSON with the validated plan, step checks, and every blocker
that can be discovered safely. A blocked plan is still a successful command
result because the annotated plan is the requested artifact. Invalid input,
unreadable or malformed plan files, browser setup failures, and navigation
failures return structured errors and exit `1`. User-facing blocker resolution
is deferred to WES-177's review workflow.

The two input forms are mutually exclusive. Validate mode also refuses
credential-bearing target URLs and blocks potentially destructive actions or
credential-like field input instead of exercising them in the browser.

## Agent Walkthrough Review And Approval

Agent hosts review, refine, and approve structured plan artifacts through JSON
commands:

```bash
npm run autodemo -- agent review --plan <plan-json-file> --json
npm run autodemo -- agent refine --plan <plan-json-file> --refinements <refinements-json-file> --json
npm run autodemo -- agent approve --plan <plan-json-file> --json
```

Review returns a transcript-safe ordered summary and approval eligibility.
Refine accepts a JSON array of `select-candidate` or `replace-step` changes,
applies the batch atomically, clears prior approval, and automatically
revalidates `validate-first` plans. Approve returns a new plan artifact with its
approval timestamp, `validated` or `best-guess-bypass` basis, and execution
content fingerprint. These commands print returned artifacts and never silently
overwrite the input file.

An unvalidated best-guess plan requires explicit user confirmation and the
additional `--allow-best-guess-bypass` flag. Draft, blocked, unresolved, unsafe,
or stale plans remain ineligible. WES-179 must verify the fingerprint before
execution; the fingerprint is consistency evidence rather than an identity
signature.

## Agent Walkthrough Execution

Execute a verified approved plan on the same browser page being recorded:

```bash
npm run autodemo -- agent execute --plan <approved-plan-json-file> [--inputs <runtime-inputs-json-file>] --out <capture-directory> [--viewport <width>x<height>] --json
```

Runtime inputs are permitted only for non-secret demo data. Values are visible
in recorded pixels but excluded from plans, metadata, diagnostics, and JSON.
Execution has no unapproved shortcut, uses strict accessible target matching and
deterministic `natural-v1` pacing, and stops on the first failed step. Expected
failures exit `1` with a preserved failed capture bundle when recording began;
interruption exits `130`. WES-180 owns capture-to-project handoff.

## Deferrals

Registry publication, Homebrew formulas, native app packaging, bundled
standalone tarballs, hosted deployment, managed updates, and other standalone
distribution artifact work remain out of scope for the balanced MVP.
