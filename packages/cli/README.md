# @auto-demo/cli

Provides the `autodemo` command and the repo-local command surface for capture,
generation, local editor handoff, agent workflow orchestration, validation, and
export.

## MVP Packaging Target

WES-168 selects one MVP packaging target: a **clean local checkout run path**.
The balanced MVP does not require registry publication, Homebrew, native
installers, or any standalone distribution artifact.

Supported environment:

- macOS
- Node 22.x
- npm 10
- Playwright Chromium installed through `npm run setup:browser`
- `ffmpeg` available on `PATH`

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
- `export`
- `validate`

## Deferrals

Registry publication, Homebrew formulas, native app packaging, bundled
standalone tarballs, hosted deployment, managed updates, and other standalone
distribution artifact work remain out of scope for the balanced MVP.
