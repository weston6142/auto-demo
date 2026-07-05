# WES-169 Agent Host Wrapper Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record the MVP agent host wrapper decision and update WES-161 so wrapper implementation scope is explicit before coding starts.

**Architecture:** This is a decision and synchronization change. Repo docs hold the decision rationale and local project map, while Linear WES-161 holds implementation acceptance criteria for the next task. No product runtime code changes are required.

**Tech Stack:** Markdown docs, Linear CLI, existing npm validation commands.

---

## File Structure

- Create `docs/superpowers/specs/2026-07-05-wes-169-agent-host-wrapper-scope-design.md`: decision spec and self-review.
- Create `docs/superpowers/plans/2026-07-05-wes-169-agent-host-wrapper-scope.md`: implementation plan.
- Modify `README.md`: surface the MVP host target near the agent workflow command docs.
- Modify `packages/agent/README.md`: document wrapper scope from the agent package boundary.
- Modify `docs/linear/auto-demo-project-structure.md`: add spec/plan links, update WES-169 state, record decision evidence, and move the next-task pointer to WES-161 after completion.
- Update Linear WES-161: replace inferred Codex/Claude parity criteria with Codex production wrapper acceptance and Claude follow-up parity documentation.

## Task 1: Decision Documents

**Files:**

- Create: `docs/superpowers/specs/2026-07-05-wes-169-agent-host-wrapper-scope-design.md`
- Create: `docs/superpowers/plans/2026-07-05-wes-169-agent-host-wrapper-scope.md`

- [ ] **Step 1: Write the failing decision check**

Run:

```bash
rg -n "Codex production wrapper" docs/superpowers/specs docs/superpowers/plans docs/linear/auto-demo-project-structure.md README.md packages/agent/README.md
```

Expected: no matches and exit code `1`, because the host-scope decision has not
been recorded yet.

- [ ] **Step 2: Add the decision spec and plan**

Write the spec with the selected decision:

```text
The MVP host target is one production Codex wrapper plus documented Claude
follow-up scope.
```

Write the implementation plan with scoped docs, Linear, verification, commit,
and no-mistakes steps.

- [ ] **Step 3: Verify the decision text exists**

Run:

```bash
rg -n "Codex production wrapper|Claude follow-up" docs/superpowers/specs/2026-07-05-wes-169-agent-host-wrapper-scope-design.md docs/superpowers/plans/2026-07-05-wes-169-agent-host-wrapper-scope.md
```

Expected: matches in both new files.

## Task 2: Local Documentation And Project Map

**Files:**

- Modify: `README.md`
- Modify: `packages/agent/README.md`
- Modify: `docs/linear/auto-demo-project-structure.md`

- [ ] **Step 1: Update public docs**

Add a short note after the agent workflow command descriptions:

```text
For the MVP host wrapper scope, Auto Demo treats a Codex production wrapper as
acceptance-critical. Claude wrapper parity is documented as follow-up scope.
```

- [ ] **Step 2: Update the project map**

Record WES-169 spec and plan paths, set WES-169 to In Progress while work is
active, and add an investigation note with the selected host decision.

- [ ] **Step 3: Verify docs behavior**

Run:

```bash
rg -n "Codex production wrapper|Claude wrapper parity" README.md packages/agent/README.md docs/linear/auto-demo-project-structure.md
```

Expected: matches in all three files.

## Task 3: Linear Scope Reconciliation

**Files:**

- Linear issue: `WES-161`
- Linear issue: `WES-169`

- [ ] **Step 1: Write the WES-161 description update**

Prepare a non-secret Markdown description that says WES-161 implements the Codex
production wrapper, includes host-neutral Claude parity documentation, and keeps
MCP/export/marketplace work out of scope.

- [ ] **Step 2: Apply the WES-161 update**

Run:

```bash
linear issue update WES-161 --description-file <temp-description-file>
```

Expected: Linear accepts the updated WES-161 criteria.

- [ ] **Step 3: Add WES-169 completion evidence**

After local verification passes, comment on WES-169 with the decision, spec
path, verification commands, and WES-161 update. Move WES-169 to Done.

## Task 4: Verification, Commit, And Gate

**Files:**

- All scoped WES-169 docs and map files.

- [ ] **Step 1: Run lightweight checks**

Run:

```bash
rg -n "Codex production wrapper|Claude wrapper parity" README.md packages/agent/README.md docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-05-wes-169-agent-host-wrapper-scope-design.md docs/superpowers/plans/2026-07-05-wes-169-agent-host-wrapper-scope.md
git diff --check
npm run validate
```

Expected: search matches, no whitespace errors, and full validation passes.

- [ ] **Step 2: Commit scoped files**

Run:

```bash
git add README.md packages/agent/README.md docs/linear/auto-demo-project-structure.md docs/superpowers/specs/2026-07-05-wes-169-agent-host-wrapper-scope-design.md docs/superpowers/plans/2026-07-05-wes-169-agent-host-wrapper-scope.md
git commit -m "docs: decide MVP agent wrapper scope"
```

- [ ] **Step 3: Run no-mistakes**

Run:

```bash
no-mistakes axi run --intent "WES-169: decide the MVP agent host wrapper scope after WES-160 stabilized the agent workflow contract. Record Codex as the production MVP wrapper target, document Claude as follow-up parity scope, update WES-161 criteria so implementation does not infer host coverage, and keep the change docs/tracker-only with behavior-oriented validation of public docs and Linear criteria."
```

Expected: no-mistakes reaches `checks-passed` with GitHub CI green.

## Plan Self-Review

- Spec coverage: the plan records the selected host target, WES-161 criteria
  update, local map synchronization, verification, commit, and no-mistakes gate.
- Placeholder scan: no TBD, TODO, or vague implementation placeholders remain.
- Type consistency: paths, issue keys, and host labels match the WES-169 spec.
