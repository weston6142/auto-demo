# WES-273 Fresh-Agent Cars.com Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the completed public-site discovery milestone by running the recorded Cars.com prompt in a genuinely fresh agent session through replay-validated review, explicit approval, recording, and project handoff.

**Architecture:** The main agent owns repository and Linear writes. A clean temporary clone isolates the acceptance environment from prior untracked Cars.com diagnostics, and a fresh context-isolated agent receives only the exact test prompt plus normal committed repository instructions. The user explicitly authorized YOLO after safe mode correctly blocked Cars.com's cross-origin side-effect traffic. The repository-owned two-phase runner still enforces the approval boundary; any necessary product correction returns to the main branch and follows RED-GREEN TDD before a completely clean acceptance rerun.

**Tech Stack:** TypeScript, Node.js, Playwright, `@auto-demo/agent`, Auto Demo CLI, Git, GitHub Actions, Linear CLI.

---

### Task 1: Lock The Acceptance Baseline

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`
- Create: `docs/superpowers/specs/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-design.md`
- Create: `docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md`

- [x] **Step 1: Capture the pre-task gate evidence**

Run:

```bash
rtk git status --short --branch
rtk git rev-parse HEAD origin/develop
rtk proxy linear issue view WES-273 --no-pager
rtk proxy linear issue view WES-265 --no-pager
```

Expected: local `develop` and `origin/develop` agree at the WES-268 completion-sync commit; WES-273 is Backlog and dependency-ready; WES-265 is Backlog; `.gitignore` and `workflow/` are the only unrelated dirty paths.

- [x] **Step 2: Prepare the issue branch**

Run:

```bash
rtk git switch -c wes-273-fresh-agent-cars-com-acceptance
```

Expected: the new branch is checked out without stashing, cleaning, or staging unrelated files.

- [x] **Step 3: Record the approved design and plan**

Add the design and this plan. Update the project map only with stable pre-task/design evidence and keep WES-273 incomplete until both acceptance phases pass.

- [x] **Step 4: Self-review the documents**

Run:

```bash
rtk rg -n 'T[B]D|T[O]DO|impl[e]ment later|fill in det[a]ils|similar to T[a]sk' docs/superpowers/specs/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-design.md docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md
rtk npm exec prettier -- --check docs/superpowers/specs/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-design.md docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md
rtk git diff --check
```

Expected: no placeholders, formatting errors, or whitespace errors.

### Task 2: Run Prompt-Only Discovery In A Fresh Agent Session

**Files:**

- Create locally, do not commit: a temporary clean acceptance checkout
- Create locally, do not commit: runner artifacts in that checkout

- [x] **Step 1: Move WES-273 to the active state**

Run:

```bash
rtk proxy linear issue update WES-273 --state 'In Progress'
```

Expected: WES-273 is In Progress. Do not change WES-265.

- [x] **Step 2: Create and verify a clean checkout**

Create a temporary directory with `mktemp -d`, clone the local repository's `develop` branch with `--local --single-branch`, and verify:

```bash
rtk git -C <acceptance-checkout> rev-parse HEAD
rtk git -C <acceptance-checkout> status --short
```

Expected: HEAD equals the locked `origin/develop` baseline and status is empty. Do not copy `.gitignore`, `workflow/`, or any other uncommitted path from the current checkout.

- [x] **Step 3: Dispatch a context-isolated acceptance agent**

Start a fresh agent with no forked turns. Its only task content, apart from the clean checkout path and instruction to follow committed repository guidance, is:

```text
Read and follow `packages/agent/skills/codex-auto-demo/SKILL.md`.

Use YOLO autonomous discovery for this public-site browsing flow on
https://www.cars.com/.

Goal: Search nationwide for new Kia Sorento vehicles, then open
the first vehicle listing shown in the results.

Requirements:

* Set condition to New.
* Set make to Kia.
* Set model to Sorento.
* Set distance to Nationwide or All miles. If the site requires a
  ZIP code and none is available, pause and ask me for one.
* Do not select sponsored inventory over organic inventory unless
  it is genuinely the first vehicle listing in the normal results
  order.
* Click only the first actual vehicle listing; do not contact a
  dealer, reveal a phone number, save/favorite a vehicle, request
  financing, or submit any form.
* Treat cookie banners and ordinary navigation as safe
  interactions.
* Move the visible mouse pointer to controls before clicking or
  focusing them. For native dropdowns, pointer-focus the control
  and choose the exact public option label with keyboard input.
  Do not loop on the same target after repeated no-effect actions.
* Use the normal headed browser default. Do not choose a headless
  profile unless I directly request headless operation.
* Use YOLO mode for discovery and replay, and freshly select YOLO
  again for recording only after explicit approval. Keep browser
  actions on Cars.com. Do not enter credentials or payment data,
  download anything, contact a dealer, reveal a phone number,
  save/favorite a vehicle, request financing, or submit a form.
* Compile the discovered path, replay it in a fresh browser, and
  repair stale targets if necessary.
* Present the sanitized, replay-validated walkthrough to me for
  explicit approval before recording.
* After I approve it, record the walkthrough and create the Auto
  Demo project at `./demos/cars-kia-sorento`.
* Do not open the editor or export an MP4 unless I request it
  afterward.

## Pass criteria

* Run in a fresh agent session with no hidden operator guidance.
* The first phase passes only when the agent reaches the sanitized replay-validated walkthrough and requests explicit approval.
* After explicit approval, recording and project handoff complete at `./demos/cars-kia-sorento`.
* The editor and MP4 export remain unopened.
* Site-caused transient failure may trigger a clean rerun, but hidden context invalidates the pass.
```

Do not send follow-up selectors, launch-profile advice, policy exceptions, Cloudflare workarounds, or prior diagnostic context.

- [x] **Step 4: Evaluate phase-one output**

Require all of these observable outcomes:

- the agent used explicitly authorized YOLO mode and kept browser actions on Cars.com;
- the runner reached `review_required`;
- the returned plan is replay-validated and blocker-free;
- the sanitized ordered steps set New, Kia, Sorento, Nationwide/All miles and open the first eligible listing;
- no recording, project handoff, editor, or export occurred;
- no hidden guidance was requested or supplied.

If the site causes a transient failure, discard the acceptance checkout and repeat Tasks 2.2 through 2.4 once with the exact same prompt. If the agent needs Cars.com-specific help, record acceptance failure and stop. If a repository defect is exposed, continue to Task 3.

Current result: the prompt-only fresh agent used the allowed clean transient rerun, reached Cars.com in a fresh headed profile, and found an already-valid ZIP. Selecting `New` changed the observed public control state but the runner correctly failed the attempt with `unsafe_navigation_blocked`, so the agent abandoned before search, replay, approval, recording, handoff, editor, or export. A bounded diagnostic reproduction established that background request URLs were rejected by the generic credential-like URL heuristic before network classification; ordinary opaque query values were the dominant trigger, with some generic `*_code`-shaped keys also matching.

### Task 3: Correct A Reproducible Repository Defect If Required

**Files:**

- Test: exact behavior-focused test file selected from the failing public boundary
- Modify: minimal issue-scoped production file selected after root-cause analysis

- [x] **Step 1: Establish root cause**

Use `superpowers:systematic-debugging`. Reproduce the failure, inspect the complete bounded error, trace the failing public boundary, compare with working repository patterns, and state one testable root-cause hypothesis. Do not use prior Cars.com diagnostics as guidance for the acceptance agent.

Root-cause hypothesis confirmed: `playwrightDiscoveryPolicyGuard.ts` calls `hasCredentialLikeUrlData()` before classifying every intercepted request. That helper intentionally treats long mixed query values and broad credential-like key fragments such as `code` as secret-like. Cars.com's ordinary background traffic therefore produces `unsafe_navigation_blocked` even though the selected form control reaches the requested state. The user approved using strict scheme/userinfo/origin validation for subresource classification while retaining credential-like URL rejection for explicit and top-level navigation.

- [x] **Step 2: Write a failing public-behavior test**

Add the smallest test that expresses the acceptance-visible defect without selectors, raw DOM, private browser state, or implementation-detail assertions.

- [x] **Step 3: Verify RED**

Run the focused test command for that file.

Expected: FAIL for the established missing or incorrect behavior, not for setup, syntax, or environment errors.

- [x] **Step 4: Implement the minimal correction**

Modify only the root-cause boundary needed by WES-273. Do not add Cars.com-specific branches or broaden policy.

- [x] **Step 5: Verify GREEN and refactor**

Run the focused test, affected package suite, typecheck, lint, and formatting. Keep output pristine. Commit the code and test with explicit paths.

- [x] **Step 6: Restart acceptance from a clean branch head**

Create a brand-new clean clone at the corrected committed head and repeat Task 2 with a different fresh agent receiving the exact prompt only. Never coach the original failed agent around the defect.

Post-fix result: rebased commit `7f86a8f` passed the full 434-test agent suite, agent typecheck, issue-owned ESLint and Prettier, and `git diff --check`. A new clean prompt-only agent first encountered a site anti-bot boundary. The allowed clean site rerun independently selected a fresh headed profile and reached Cars.com. Selecting `New` then changed the public control state without the former credential-URL false positive, proving the correction. Cars.com also attempted classified cross-origin XHR/fetch potential-side-effect traffic; the safe policy blocked it as `network_request_blocked`, and the fresh agent abandoned before all later phases. The user then explicitly authorized changing the recorded acceptance tier to YOLO while retaining mandatory review/approval and all prompt-level prohibitions.

The first YOLO rerun exposed a second product defect. The agent selected `New`, then issued 26 Make/Kia actions: one direct native-select action failed and 25 direct element clicks followed, 18 with no observable effect. No pointer movement occurred, Kia was never observed selected, and later filters were not reached. The user stopped the run and required visible mouse interaction. The correction must cover discovery, fresh replay, and approved recording so the reviewed behavior matches the recorded demo: scroll into view, move the pointer to the target, click or focus it, and use keyboard selection by exact public label for native selects. Add public-behavior RED tests at each execution boundary, implement the smallest shared package-local helpers, verify all affected suites, commit, and restart acceptance from a brand-new clean clone.

Rebased pointer commit `6f76993` passed 435 agent tests and 78 capture tests plus both typechecks and focused static checks. Its fresh acceptance rerun visibly moved the pointer and stopped without looping, but Cars.com's overlapping native options caused keyboard type-ahead for exact `New` to select `New & certified`; the exact-label post-check correctly failed. RED reproduced that mismatch across discovery, replay, and recording. GREEN rebased commit `e272d8c` uses bounded native type-ahead cycling after pointer focus, checking only normalized public labels and never private option values or DOM selection. The full affected suites again pass 435 agent and 78 capture tests, both typechecks, focused ESLint/Prettier, and `git diff --check`. Restart acceptance from a brand-new clean clone at the reconciled branch head.

The pre-reconciliation run confirmed `New`, but Cars.com's Make dropdown exposed repeated identical public make labels and the helper rejected exact `Kia` as ambiguous before typing. The run also spent a guaranteed first attempt on headless bundled Chromium, which Cloudflare blocked, before headed Chrome reached the site. The user directed that ordinary autonomous runs always start headed and reserve headless for explicit requests. RED proved the missing headed default and duplicate-public-option behavior. GREEN rebased commit `35f1f34` defaults omitted autonomous launch plans to headed Chrome with a headed bundled fallback, keeps explicit headless profiles supported, and permits one-or-more enabled identical public labels only when the selected control visibly reports the exact requested label. Full verification passes 13 browser-profile tests, 436 agent tests, 78 capture tests, all affected typechecks, focused ESLint/Prettier, and `git diff --check`. Restart from a clean clone at the reconciled branch head with the exact prompt and omitted/default launch plan.

If no product defect is found, mark every Task 3 step as not required in the final plan disposition rather than inventing code changes.

### Task 4: Obtain Explicit Approval And Complete Recording

**Files:**

- Create locally, do not commit: `demos/cars-kia-sorento/**`
- Create locally, do not commit: acceptance execution and handoff artifacts

- [ ] **Step -1: Require the supervised macOS capture helper gate**

Complete the approved
[macOS capture helper supervision plan](./2026-07-21-wes-273-macos-capture-helper-supervision.md)
through its real signed-helper capture and cleanup check before creating the
fresh acceptance checkout. The capture app must be launched through Launch
Services, permission must belong to `com.autodemo.capture-helper`, and neither
the helper nor supervisor may remain after close.

- [ ] **Step 0: Resume acceptance with WES-274 visual feedback**

Create a brand-new clean clone at the reconciled WES-273 branch head. Dispatch a different context-isolated agent with the exact prompt from Task 2.3 and no forked conversation history. Require it to use the repository-owned visual decision channel delivered by WES-274, reach `review_required`, and return a replay-validated blocker-free sanitized walkthrough. Do not provide Cars.com-specific guidance, and do not reuse the paused acceptance checkout.

Expected: New, Kia, Sorento, and Nationwide/All miles are selected; the first eligible listing is opened during replay; the agent returns the complete sanitized review; no recording, project handoff, editor, or export has occurred.

- [ ] **Step 1: Present the full sanitized review to the user**

Report every ordered public step, assumption, warning, and blocker from the fresh agent's transcript-safe review. Ask one focused question: whether the user explicitly approves this exact walkthrough for recording.

Expected: no approval command runs until the user answers affirmatively.

- [ ] **Step 2: Record approval through the supported contract**

Send the user's explicit approval to the same isolated acceptance agent. The agent must persist approval through the Auto Demo approval API or CLI; conversation text or a boolean alone is insufficient.

- [ ] **Step 3: Run fresh recording and handoff**

The isolated agent calls the post-approval runner path with `yolo` freshly established and the approved launch profile, creates a fresh capture, and hands it off to:

```text
./demos/cars-kia-sorento
```

Expected: completed recording and project handoff; no editor process and no export artifact.

- [ ] **Step 4: Verify the generated project through the public interface**

Run from the acceptance checkout:

```bash
rtk npm run autodemo -- validate ./demos/cars-kia-sorento
rtk npm run autodemo -- agent run --project ./demos/cars-kia-sorento --json
```

Expected: project validation succeeds and the agent handoff summary selects a valid saved variant without opening the editor.

- [ ] **Step 5: Preserve the requested local artifact**

If the current checkout has no `demos/cars-kia-sorento`, copy the completed generated project from the clean acceptance checkout into that exact relative path. Keep generated media and project artifacts unstaged unless repository policy explicitly requires them in source control.

### Task 5: Record Evidence, Verify, And Review

**Files:**

- Modify: `docs/linear/auto-demo-project-structure.md`
- Modify: `docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md`
- Modify if scope changed: `docs/superpowers/specs/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-design.md`

- [ ] **Step 1: Update stable completion evidence**

Append bounded evidence to the project map: clean baseline commit, fresh-agent prompt-only boundary, phase-one replay validation, explicit approval, phase-two recording/handoff, public project validation, and confirmation that editor/export stayed unused. Mark WES-273 and WES-265 as pending integration until the PR merges.

- [ ] **Step 2: Close completed plan checkboxes**

Mark completed steps. For conditional Task 3, explicitly record `Not required: acceptance exposed no repository defect` when applicable, then check its steps so no in-scope ambiguity remains.

- [ ] **Step 3: Run focused documentation and artifact verification**

Run:

```bash
rtk npm exec prettier -- --check docs/superpowers/specs/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-design.md docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md docs/linear/auto-demo-project-structure.md
rtk npm --workspace @auto-demo/agent test -- --run src/wrapper-docs.test.ts
rtk git diff --check
rtk git status --short
```

Expected: formatting, docs contract, and diff checks pass; only issue-owned docs plus preserved unrelated and generated local artifacts appear. If Task 3 changed production code, run the complete relevant repository validation instead of this docs-only gate.

- [ ] **Step 4: Request independent read-only review**

Give a reviewer WES-273, the design, this plan, the exact prompt, bounded acceptance evidence, and the issue diff. Require a Critical/Important/Minor classification and a Ready/Not Ready verdict. Verify every finding before acting; fix valid in-scope findings and rerun affected checks.

- [ ] **Step 5: Commit issue-owned evidence**

Stage only the design, plan, and project-map paths, plus any Task 3 code/test paths if they exist. Do not stage `.gitignore`, prior `workflow/` diagnostics, temporary acceptance clones, captures, or generated demo artifacts.

```bash
rtk git commit -m "WES-273: record fresh-agent Cars.com acceptance"
```

### Task 6: Publish, Merge, And Synchronize

**Files:**

- Modify if completion audit requires it: `docs/linear/auto-demo-project-structure.md`
- Modify if completion audit requires it: `docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md`

- [ ] **Step 1: Publish the WES-273 PR**

Push `wes-273-fresh-agent-cars-com-acceptance` and open a PR to `develop`. Include WES-273, the design and plan, exact prompt-only/fresh-agent evidence, approval evidence, project validation commands, independent review, and preserved unrelated paths.

- [ ] **Step 2: Monitor exact-head checks and review threads**

Use structured PR status. Diagnose failed checks with `gh-pr-failing-tests` before changing code, triage review comments with `gh-pr-review-triage`, apply only verified in-scope fixes, and push until required checks pass with no unresolved actionable findings.

- [ ] **Step 3: Verify the plan before merge**

Run:

```bash
rtk rg -n '^\s*[-*]\s+\[ \]' docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md
```

Expected: only publication, merge, and completion-sync steps whose prerequisites have not occurred may remain unchecked.

- [ ] **Step 4: Squash merge and synchronize local `develop`**

After all checks and findings are clear, squash merge. Verify `origin` owns the PR base, switch to `develop`, fetch `origin/develop`, and run:

```bash
rtk git pull --ff-only origin develop
```

Expected: local `develop` contains the WES-273 squash commit and the unrelated `.gitignore`, `workflow/`, and generated `demos/` artifacts remain preserved.

- [ ] **Step 5: Run the completion sync gate**

Validate the merged PR, squash commit, CI, fresh-agent evidence, explicit approval, project validation, review, spec, plan, and map. Add WES-273 completion evidence and move it to Done. Reconcile all Milestone 10 children, add WES-265 completion evidence, move WES-265 to Done, and clear the next-task pointer for this milestone.

- [ ] **Step 6: Publish a scoped completion-sync PR if required**

If the final gate changes tracked map or plan evidence after merge, create `wes-273-completion-sync`, commit only those files, open a PR to `develop`, wait for checks, squash merge, and fast-forward local `develop` again. Never push directly to `develop`.

- [ ] **Step 7: Confirm no unfinished in-scope plan items**

Run:

```bash
rtk rg -n '^\s*[-*]\s+\[ \]' docs/superpowers/plans/2026-07-20-wes-273-fresh-agent-cars-com-acceptance-plan.md
```

Expected: no unchecked in-scope items remain; any transferred or excluded item has an explicit disposition.
