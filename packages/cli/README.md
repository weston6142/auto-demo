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

## Deferrals

Registry publication, Homebrew formulas, native app packaging, bundled
standalone tarballs, hosted deployment, managed updates, and other standalone
distribution artifact work remain out of scope for the balanced MVP.
