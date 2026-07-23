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
npm run autodemo -- setup capture-helper --json
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
- `setup capture-helper`
- `discover start|observe|act|status|finish|abandon`
- `generate`
- `open`
- `agent run`
- `agent validate`
- `export`
- `validate`

On macOS, `setup capture-helper` builds and installs the locally signed
`~/Applications/Auto Demo Capture.app`. The signing certificate and private key
remain in Keychain, and neither signing data nor the built app belongs in the
repository. Discovery preflights the helper signature, protocol, and Screen
Recording permission before opening the browser. Setup and runtime use the
bundle's `AutoDemoCaptureSupervisor` to start the signed app through Launch
Services. Screen Recording belongs only to `com.autodemo.capture-helper`, and
normal session close terminates the exact app instance returned by Launch
Services; the idle timeout remains an orphan backstop. The CLI never falls back
to launching the inner helper directly or granting capture permission to the
terminal or model host.

Each macOS discovery session retains a private
`native-capture-diagnostics.jsonl` with bounded helper lifecycle, timing,
region, and failure-stage codes. It excludes screenshots, page content,
authentication material, private paths, signing data, and raw system error
descriptions.

## Agent Plan Intake

New walkthrough plans come from evidence-backed discovery compilation. Persist
the compiled plan before using the CLI lifecycle below; the CLI does not create a
plan from unobserved natural-language text.

## Agent Walkthrough Validation

`autodemo agent validate` rehearses an existing legacy `deterministic-v1`
walkthrough plan against browser page state without recording a capture or
creating an Auto Demo project:

```bash
npm run autodemo -- agent validate --plan <plan-json-file> --json
```

The command prints JSON with the validated plan, step checks, and every blocker
that can be discovered safely. A blocked plan is still a successful command
result because the annotated plan is the requested artifact. Invalid input,
unreadable or malformed plan files, browser setup failures, and navigation
failures return structured errors and exit `1`. User-facing blocker resolution
is deferred to WES-177's review workflow.

Plan-file validation accepts existing `deterministic-v1` artifacts for migration
compatibility. Discovery plans use fresh-context replay instead; dry-run
validation rejects them. Review, refinement, approval, and execution retain both
supported artifact lifecycles. Existing best-guess artifacts still require an
explicit bypass approval, but discovery plans never use the best-guess bypass.
Validate mode refuses credential-bearing target URLs and blocks
potentially destructive actions or credential-like field input instead of
exercising them in the browser.

`src/agenticDiscoveryAcceptance.test.ts` provides the deterministic local CI
journey for the supported discovery artifact lifecycle. It verifies semantic
first-occurrence selection among duplicate links, expected cross-page state,
stale-target direct-child repair, fresh replay, explicit approval, completed and
failed capture bundles, loadable project handoff with `baseline-polish`, and
retained editor/export next steps. Its mutation fixture requires a fresh
exact-origin disposable acknowledgement; safe mode remains non-mutating. This
coverage does not add a discovery CLI or embedded model, and public-site smoke
is optional.

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

For discovery-derived plans, `agent execute` uses the approved browser launch profile unchanged,
including channel, headless mode, and viewport. Omitting `--viewport` derives it from that profile;
an explicit viewport must match or execution fails before capture. The recording still launches a
fresh isolated browser and context and never reuses cookies, storage state, or authenticated state.
Plans without a profile retain bundled headless Chromium at 1280x720. Capture reports a recognized
human-verification page as `anti_bot_challenge`, separately from policy failures.

## Deferrals

Registry publication, Homebrew formulas, native app packaging, bundled
standalone tarballs, hosted deployment, managed updates, and other standalone
distribution artifact work remain out of scope for the balanced MVP.
