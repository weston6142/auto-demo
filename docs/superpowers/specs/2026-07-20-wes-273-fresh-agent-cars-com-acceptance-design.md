# WES-273 Fresh-Agent Cars.com Acceptance Design

Date: 2026-07-20
Issue: WES-273, "Pass fresh-agent Cars.com Kia Sorento acceptance"

## Goal

Prove the completed Risk-Tiered Public-Site Discovery milestone from the recorded Cars.com prompt alone. A fresh agent must autonomously reach a sanitized, replay-validated walkthrough, pause for explicit user approval, then record the approved walkthrough and hand it off to `./demos/cars-kia-sorento` without opening the editor or exporting an MP4. After safe-mode acceptance exposed unavoidable cross-origin side-effect traffic, the user explicitly changed the acceptance tier to YOLO; review and approval remain mandatory.

## Scope

WES-273 owns acceptance execution and durable evidence. It does not add Cars.com-specific selectors, browser-profile advice, Cloudflare workarounds, or other hidden guidance. YOLO disables Auto Demo discovery, replay, and recording safeguards as explicitly authorized, but it does not weaken review, approval, host/platform/repository rules, the prompt's behavioral prohibitions, editor, or export boundaries.

If the acceptance exposes a repository defect, the defect may be corrected on the WES-273 branch only when its root cause is established and a behavior-focused failing test reproduces it. Site-caused transient failure may receive one clean rerun. A need for supplementary Cars.com guidance is an acceptance failure, not permission to coach the agent.

The YOLO acceptance exposed a second repository defect before Kia could be selected: discovery repeatedly activated the Make control through element APIs without visible pointer travel, then retried the same no-effect target. Discovery, fresh replay, and approved recording must instead use the same pointer-first interaction contract. Every click-capable action scrolls the target into view, visibly moves the pointer to the target, and clicks or focuses it. Native selects are focused by pointer and choose the exact public option label with keyboard input. Direct DOM event dispatch and Cars.com-specific selection logic are prohibited.

Repeated acceptance also proved that ordinary autonomous public-site discovery should not spend its first attempt on headless Chromium. New runs default to headed installed Chrome with a headed bundled-Chromium fallback. Headless mode remains supported only through an explicit user-selected launch profile. Duplicate enabled native options with the same public label are equivalent at the public behavior boundary; selection may choose any of them only when the control visibly reports the exact requested label.

## Approaches Considered

### Clean Clone And Fresh Context-Isolated Agent (Selected)

Create a temporary clean clone at the exact reconciled WES-273 branch head and dispatch a fresh agent with no conversation history. Give it only the exact WES-273 test prompt, the clean checkout path, and the instruction to follow normal committed repository guidance. This prevents the acceptance agent from seeing the current checkout's preserved untracked `workflow/cars-kia-sorento/` diagnostics while including WES-274's visual decision channel and the previously verified WES-273 corrections.

The agent owns discovery decisions through the repository-owned runner. It returns only transcript-safe review evidence when the runner reaches `review_required`. After the user explicitly approves that displayed walkthrough, the same isolated agent resumes the persisted checkpoint, freshly establishes YOLO for recording, and hands off the project.

### Current Checkout With A Fresh Agent

This would be operationally smaller, but the checkout contains prior untracked Cars.com diagnostics. Even without deliberately opening them, their presence makes the environment weaker evidence for "prompt alone." Rejected.

### Main-Agent Acceptance

The main agent already knows prior Cars.com failure modes and milestone history. It cannot serve as the fresh acceptance agent. Rejected.

## Environment And Evidence Boundary

Before acceptance resumes, the macOS capture boundary must satisfy the approved
[WES-273 macOS capture helper supervision design](./2026-07-21-wes-273-macos-capture-helper-supervision-design.md).
The signed app must own Screen Recording through Launch Services, and the real
local helper gate must prove one capture plus complete shutdown and cleanup.
This correction is part of WES-273 because the prior direct inner-executable
launch made fresh screenshot-coordinate acceptance impossible despite green
mocked TypeScript tests.

- The clean clone is created from the verified `origin/develop` commit before WES-273 evidence documentation is added.
- The fresh agent receives no forked conversation context and no summary of prior Cars.com attempts.
- The only task content supplied is the exact Linear test prompt. The checkout path is operational routing, not product guidance.
- The acceptance agent may read committed `AGENTS.md`, `packages/agent/skills/codex-auto-demo/SKILL.md`, package documentation, and source code as normal repository instructions permit.
- It must not inspect the dirty source checkout or its untracked `workflow/` artifacts.
- Durable runner artifacts, plans, captures, and projects remain local and must not expose raw observations, selectors, request data, credentials, runtime values, or private browser state in conversation or committed evidence.

## Acceptance Flow

1. Verify the project binding and dependency-ready WES-273 state, then resume the existing WES-273 branch while preserving unrelated dirty files.
2. Reconcile the branch onto current `develop`, including WES-274's focus-preserving visual decision channel, then create a clean clone at the exact reconciled branch head and dispatch a fresh context-isolated agent with the recorded prompt only.
3. The fresh agent follows the repository skill, uses `yolo` mode while keeping browser actions on Cars.com, and drives discovery through `runAutonomousDiscoveryToReview()` rather than an ad hoc lifecycle.
4. Discovery, replay, and recording use pointer-first interactions. Repeated `action_no_observable_effect` results on the same target are not treated as progress.
5. If Cars.com requires a ZIP code and none is available, the agent pauses and asks the user. No ZIP is invented.
6. A successful first phase returns a sanitized replay-validated walkthrough and requests explicit approval. No recording or handoff occurs before that approval.
7. The main agent presents the complete transcript-safe review to the user. The user must explicitly approve it; the delivery invocation does not substitute for this product safety gate.
8. After approval, the isolated agent records approval through the existing approval contract, calls the post-approval runner path with YOLO freshly established, records the walkthrough in a fresh context, and creates `./demos/cars-kia-sorento` inside the clean acceptance checkout.
9. Copy the completed local project into the user's current checkout at the same relative path without staging it unless repository policy clearly treats generated demo artifacts as source.
10. Record only bounded acceptance evidence in the design, plan, and project map; verify the artifact with supported public commands; independently review the evidence; publish and merge the WES-273 PR.
11. Run the completion sync. Mark WES-273 Done only after both phases pass. Close WES-265 only when all children and the final acceptance are verified.

## Failure Handling

- In YOLO, Auto Demo policy denials are disabled. The agent still obeys the prompt's prohibitions against credentials, payment, downloads, dealer contact, phone-number reveal, saving/favoriting, financing, and form submission, plus all host/platform/repository rules. Missing approval always stops the run.
- A site-caused transient failure may trigger one entirely clean rerun with the exact same prompt and no additional context.
- An anti-bot or infrastructure failure is reported using bounded diagnostics only.
- A missing ZIP pauses for the user's value; the value remains runtime-only and is never committed or pasted into logs.
- Any request from the fresh agent for selectors, browser-profile tips, mutation exceptions, Cloudflare workarounds, or other Cars.com-specific help fails WES-273.
- If a product defect is found, use systematic debugging to isolate it, add a failing public-behavior test, implement the smallest fix, rerun the affected acceptance phase from a new clean clone, and preserve the original failure evidence.
- Existing non-empty output directories are never overwritten. A collision blocks until ownership is resolved.

## Verification Strategy

- Confirm the clean acceptance checkout is at the intended reconciled WES-273 branch commit and has no untracked files before dispatch.
- Preserve the exact prompt used and the fresh-agent identity in bounded evidence.
- Verify phase one returned `review_required`, a replay-validated plan, a blocker-free sanitized review, and no recording or handoff artifacts.
- Verify explicit approval was captured through the supported approval contract.
- Verify phase two freshly re-established YOLO, completed recording and project handoff, and that `./demos/cars-kia-sorento` validates through the public Auto Demo command.
- Verify no editor process was opened and no MP4 export artifact was created.
- Verify the current checkout's unrelated `.gitignore` and `workflow/` changes remain unstaged and unchanged.
- Run documentation formatting, contract tests affected by evidence updates, and `git diff --check`. Run broader repository checks only if acceptance-driven code changes occur.

## Acceptance Criteria

- A genuinely fresh agent receives the exact WES-273 prompt plus normal committed repository instructions and no hidden Cars.com guidance.
- Discovery in explicitly authorized YOLO mode reaches a sanitized, replay-validated walkthrough for nationwide new Kia Sorento results and the first eligible vehicle listing.
- Discovery, replay, and recording visibly move the browser pointer before clicking or focusing interactive targets; native select choices use the exact public label without DOM-dispatched synthetic events.
- Ordinary autonomous discovery begins headed and never falls back to headless unless the user explicitly requested a headless profile.
- Recording does not start until the user explicitly approves the displayed walkthrough.
- After approval, recording and project handoff complete at `./demos/cars-kia-sorento`.
- The editor remains unopened and no MP4 is exported.
- WES-273, WES-265, the project map, merged PR evidence, and local `develop` agree before completion is reported.

## Self-Review

- Placeholder scan: no unfinished marker or deferred acceptance decision remains.
- Consistency: the clean-agent boundary, prompt-only rule, explicit approval pause, phase-scoped YOLO selection, and post-approval recording flow agree throughout.
- Scope: the design covers one final acceptance issue and permits only defects necessary to make that acceptance truthful.
- Ambiguity: transient retry, missing ZIP, hidden-guidance failure, output ownership, and milestone closure rules are explicit.
