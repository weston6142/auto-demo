# Auto Demo Linear Project Map

Last updated: 2026-06-27

## Project

- Linear project: Auto Demo Balanced MVP
- Project ID: `4d54d7dd-094f-411b-96a2-0768ec5d7eb7`
- Project URL: https://linear.app/weston-bushyeager/project/auto-demo-balanced-mvp-d31ba2ab0940
- Current project state: Planned

## Local Context

- Current workspace: `/Users/weston.bushyeager/code/personal/auto-demo`
- Git repository: https://github.com/weston6142/auto-demo
- Primary branch: `develop`
- Product design spec: `docs/superpowers/specs/2026-06-27-auto-demo-balanced-mvp-design.md`
- WES-136 foundation design spec: `docs/superpowers/specs/2026-06-27-wes-136-public-repo-foundation-design.md`

## Milestone Order

Milestone order is taken from the balanced MVP design spec because the Linear CLI milestone list currently returns the milestones alphabetically.

1. Public Repo And Project Foundation
2. Capture Runtime
3. Demo Project Format
4. Auto Polish Engine
5. Headless Variant Generation
6. Browser Editor
7. Agent Integrations
8. Export And Packaging

## Current Next-Task Selection Rule

Prefer the earliest milestone with incomplete issues. Within that milestone, prefer started issues, then foundational setup or project-map issues that unblock later work, then the oldest backlog issue. Current next product task: WES-135.

## Issues By Milestone

### 1. Public Repo And Project Foundation

- WES-141: Document repo project structure and Linear map - Done - https://linear.app/weston-bushyeager/issue/WES-141/document-repo-project-structure-and-linear-map
- WES-136: Milestone 1: Public repo and project foundation - Done - https://linear.app/weston-bushyeager/issue/WES-136/milestone-1-public-repo-and-project-foundation

### 2. Capture Runtime

- WES-135: Milestone 2: Capture runtime - Backlog - https://linear.app/weston-bushyeager/issue/WES-135/milestone-2-capture-runtime

### 3. Demo Project Format

- WES-134: Milestone 3: Demo project format - Backlog - https://linear.app/weston-bushyeager/issue/WES-134/milestone-3-demo-project-format

### 4. Auto Polish Engine

- WES-133: Milestone 4: Auto polish engine - Backlog - https://linear.app/weston-bushyeager/issue/WES-133/milestone-4-auto-polish-engine

### 5. Headless Variant Generation

- WES-137: Milestone 5: Headless variant generation - Backlog - https://linear.app/weston-bushyeager/issue/WES-137/milestone-5-headless-variant-generation

### 6. Browser Editor

- WES-140: Milestone 6: Browser editor - Backlog - https://linear.app/weston-bushyeager/issue/WES-140/milestone-6-browser-editor

### 7. Agent Integrations

- WES-138: Milestone 7: Agent integrations - Backlog - https://linear.app/weston-bushyeager/issue/WES-138/milestone-7-agent-integrations

### 8. Export And Packaging

- WES-139: Milestone 8: Export and packaging - Backlog - https://linear.app/weston-bushyeager/issue/WES-139/milestone-8-export-and-packaging

## Investigation Notes

- Selected next task: WES-141, because the project map did not exist and this document is the local orientation layer for subsequent Linear work.
- WES-141 expected outcome is concrete: create and maintain this repo-local Markdown map with project URL, milestone order, issue grouping, status conventions, spec links, and update rules.
- 2026-06-27 recheck: Linear still shows WES-141 in Backlog, but this repo-local map now exists and contains the requested project URL, milestone order, issue grouping, status conventions, spec links, investigation notes, completion evidence, and update rules. Recommended next action is to add completion evidence to Linear and move WES-141 to Done before selecting WES-135 for the next product brainstorming cycle.
- WES-136 has been brainstormed into a foundation design spec. The approved direction is an npm TypeScript workspace, MIT license, browser-first capture adapter boundary, minimal package skeleton, behavior-oriented tests, and minimal GitHub Actions CI for setup validation.
- The current workspace is a Git repository on `develop` with the npm workspace foundation committed, including root docs, tooling config, and package directories for agent, capture, CLI, editor, polish, project, and render.

## Completion Evidence

- WES-136: Repository foundation initialized as an npm TypeScript workspace.
- GitHub repository: https://github.com/weston6142/auto-demo
- Primary/default branch: `develop`
- License: MIT.
- Package boundaries: CLI, project, capture, polish, render, editor, and agent.
- Capture direction: browser-first adapter contract with future Mac-native adapter room.
- Validation: `npm run validate --cache ./.npm-cache` passed locally.
- Security baseline: `npm audit --cache ./.npm-cache` reported 0 vulnerabilities.
- CI: `.github/workflows/ci.yml` runs `npm ci` and `npm run validate` on pull requests and pushes to `develop`; latest run passed on `develop`.
- Linear: evidence comment added and WES-136 moved to Done.
- WES-141: Repo-local project map exists at `docs/linear/auto-demo-project-structure.md` with project URL and ID, milestone order, issue grouping, selection rule, spec links, investigation notes, completion evidence, and update rules.
- Linear: evidence comment added and WES-141 moved to Done on 2026-06-27.

## Update Rules

Update this document when:

- Linear issues in the Auto Demo Balanced MVP project are created, edited, completed, reprioritized, or materially investigated.
- Milestones are added, renamed, reordered, completed, or canceled.
- Local specs, plans, or architecture documents are added or superseded.
- Completion evidence is gathered for finished Linear issues.

Keep entries concise. This file should orient future work; Linear remains the source of truth for full issue descriptions, comments, and state transitions.
