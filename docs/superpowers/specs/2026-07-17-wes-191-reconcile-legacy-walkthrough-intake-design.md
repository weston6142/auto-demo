# WES-191 Legacy Walkthrough Intake Reconciliation Design

## Goal

Retire the pre-agentic natural-language parser and its duplicate CLI intake paths while preserving the durable `WalkthroughPlan` lifecycle and a bounded migration path for previously saved deterministic plans.

## Context

The repository now has an evidence-backed discovery path: a host agent creates a bounded discovery session, `compileDiscoverySessionToWalkthroughPlan()` emits a durable draft plan, replay and repair establish fresh-context validation, and the existing review, approval, deterministic execution, capture, and project handoff lifecycle completes the workflow. The older `createWalkthroughPlan()` parser guesses actions from natural-language text without observing the page. `autodemo agent plan` and the URL/script form of `autodemo agent validate` expose that parser as parallel public intake paths.

WES-191 makes discovery compilation the only documented way to create new walkthrough plans. It does not change the plan artifact format, approval fingerprints, replay/final execution, transcript safety, capture, or handoff behavior.

## Considered Approaches

### 1. Remove all deterministic and best-guess compatibility

Delete the parser, CLI entrypoints, source variants, best-guess mode, bypass approvals, and all legacy artifact handling. This gives the smallest surface but makes already-saved plans unreadable and expands WES-191 into an artifact-format migration.

### 2. Retain a compatibility shell around durable artifacts (selected)

Delete all public plan-creation paths while retaining plan-file validation, review, refinement, approval, execution, and handoff. Existing `deterministic-v1` and `best-guess` artifacts remain accepted as deprecated migration compatibility, with behavior-first tests proving safety and lifecycle preservation. New documentation teaches only discovery compilation.

This removes competing intake behavior, preserves user data, and keeps the change reversible without maintaining a parser that guesses browser behavior.

### 3. Keep every path and add deprecation notices

Leave the parser and both CLI forms operational but label them legacy. This minimizes code changes but continues to expose multiple intake paths and does not satisfy the requirement that discovered plans use one documented approval and recording path.

## Legacy Surface Inventory

| Surface                                                              | Classification         | Result                                                                                                                                                                                           |
| -------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `createWalkthroughPlan()` and `normalizeStep()` deterministic parser | Removed                | Delete production parser logic and its public export.                                                                                                                                            |
| `autodemo agent plan --url ... --script ...`                         | Removed                | Remove routing, parsing, help, docs, and parser-specific CLI tests. Return the normal unsupported-agent-command response.                                                                        |
| `autodemo agent validate --url ... --script ...`                     | Removed                | `agent validate` accepts only `--plan <file> --json`. URL/script/mode arguments become unknown arguments.                                                                                        |
| `autodemo agent validate --plan ...`                                 | Retained               | This is the supported durable-artifact validation command for manual and migrated artifacts. Discovery replay remains the required validation path for compiled discovery plans before approval. |
| `autodemo agent review/refine/approve`                               | Retained               | These remain the shared artifact lifecycle for discovery plans and compatible legacy plans. Refinement continues to revalidate and clear stale approvals.                                        |
| `autodemo agent execute` and handoff                                 | Retained               | Approved artifact execution, capture-to-project import, baseline polish, editor, and export contracts are unchanged.                                                                             |
| `deterministic-v1` source artifacts                                  | Migrated compatibility | The schema reader and lifecycle continue accepting previously persisted plans, but no public API or CLI creates new ones.                                                                        |
| `best-guess` mode and explicit bypass approval                       | Migrated compatibility | Existing artifacts may still be reviewed and explicitly approved with `--allow-best-guess-bypass`; docs label this deprecated and prohibit it for discovery plans.                               |
| Deterministic parser fixtures and transcript examples                | Removed or narrowed    | Remove parser-generation fixtures. Keep only the minimum saved-artifact fixtures needed to prove migration compatibility and transcript safety.                                                  |
| Codex and Claude workflow guidance                                   | Migrated               | Describe discovery compilation as the only creation path and the durable plan-file lifecycle as the shared downstream path.                                                                      |

## Architecture And Boundaries

`@auto-demo/agent` keeps `WalkthroughPlan`, validation, review, refinement, approval, execution, discovery compilation, and replay contracts. The `deterministic-v1` source member and `best-guess` mode remain schema-level compatibility types rather than creation features. Parser-only inputs, error codes, helpers, and exports are removed when no retained artifact reader needs them.

`@auto-demo/cli` routes supported subcommands directly. `agent validate` reads one durable plan artifact and runs the existing browser validation. It no longer synthesizes an in-memory plan from URL/script arguments. Review, refine, approve, execute, and handoff keep consuming files, so all documented flows converge at the artifact boundary.

The repository-owned Codex skill and Claude-parity guidance describe one creation path:

1. discover safely through structured observation and policy-bounded actions;
2. compile selected evidence into a draft `WalkthroughPlan`;
3. replay and repair in a fresh isolated context;
4. persist the validated plan artifact;
5. review, explicitly approve, execute under capture, and hand off the result.

YOLO remains discovery-only and never authorizes approval, final capture mutation, best-guess bypass, or authority carryover.

## Error Behavior

- `autodemo agent plan` is no longer a recognized agent subcommand and fails through the existing unsupported-command behavior.
- `autodemo agent validate` without `--plan` returns a structured `missing_validate_input` error naming the required plan file.
- URL, script, and mode flags passed to `agent validate` return structured `unknown_agent_argument` errors.
- Missing, malformed, or invalid plan files retain their current non-secret structured errors.
- Legacy plan artifacts remain sanitized before review, refinement, approval, validation, and execution; raw typed input and secret-like values must not leak into public output.

## Documentation

Update root help, the root README, package READMEs, the repository-owned Codex skill, and Claude-parity guidance so none advertises retired plan creation or URL/script validation. Add a concise compatibility statement near plan-file commands: `deterministic-v1` and best-guess files are accepted only to migrate existing artifacts, new workflows must use discovery compilation, and discovery plans may never use best-guess bypass.

The project map records the inventory decision, implementation evidence, and deterministic next-task pointer. WES-190 remains downstream and its acceptance coverage must use only discovery compilation plus supported plan-file lifecycle commands.

## Testing

Behavior-focused tests will prove:

- public help and docs expose no `agent plan` or URL/script validation entrypoint;
- invoking the retired command fails as unsupported;
- plan-only validation succeeds for a durable compatible fixture;
- URL/script validation flags fail with stable structured errors;
- an existing deterministic best-guess artifact can still be reviewed and requires explicit bypass to approve;
- discovery plans use validated approval only and cannot use best-guess bypass;
- refinement, approval fingerprints, execution, transcript redaction, replay, and handoff regression suites remain green;
- repository build, typecheck, lint, all tests, and formatting pass.

Tests assert command results, artifact state transitions, sanitized public output, and final user-facing effects rather than private parser or dispatch mechanics.

## Scope

In scope: parser and CLI removal, compatibility classification, focused fixture/test migration, public help and documentation, Codex/Claude parity, and project-map synchronization.

Out of scope: changing the discovery session schema, adding a discovery CLI, changing replay policy, changing approval fingerprint semantics, migrating saved artifact files in place, changing capture/project/export behavior, or implementing WES-190 acceptance scenarios.

## Approved Assumptions

- Preserving readable saved artifacts is more valuable than deleting compatibility enum members in this issue.
- A manual operator may validate a durable plan file, but creating a new plan from unobserved natural-language text is no longer supported.
- Best-guess approval remains explicit, deprecated compatibility for existing artifacts only; it is never valid for discovery-created plans.
- The unrelated `.gitignore` modification belongs to the user and remains unstaged and unchanged.
