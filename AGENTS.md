# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

- Add durable project-specific notes here as they are discovered through real work.
- WES-168 selected a clean local checkout run path as the MVP packaging target. Do not assume registry publication, Homebrew, or standalone distribution artifacts are in scope. The intended repo-root wrapper contract is `npm run autodemo -- <subcommand...>`; until WES-164 implements that wrapper, the working local fallback is `npm --workspace @auto-demo/cli exec autodemo -- <subcommand...>`, and repo-root `npm exec autodemo -- ...` currently falls through to the public registry.
