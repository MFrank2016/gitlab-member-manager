## Context
Workflow definitions already persist a `variables_schema` JSON object and render built-in git steps in the React editor. Runtime placeholder substitution is driven by `${name}` strings embedded in step parameters, but the editor does not help users keep declared variables in sync with those references. The current merge-step wording is also misleading because the target branch is implicit in the earlier checkout/pull steps, not directly configured on `git_merge`.

## Goals / Non-Goals
- Goals:
  - replace the raw JSON variable editor with a simple variable/default-value form
  - auto-add missing variables when users add or edit step placeholders
  - block save when steps reference undeclared variables
  - clarify the merge-step wording without changing backend execution semantics
- Non-Goals:
  - no backend schema migration
  - no new workflow execution dialog in this change
  - no automatic use of variable defaults during workflow-run execution yet

## Decisions
- Decision: keep storing workflow variables in `variables_schema`, but reinterpret it as a flat object of `name -> defaultValue`.
  - Why: the backend already accepts any JSON object, so the editor can become more usable without a database change.
- Decision: scan step parameter strings for `${...}` placeholders after every step edit.
  - Why: it keeps the variable form aligned with the actual workflow definition and avoids stale declarations.
- Decision: treat auto-added variables as empty-string defaults.
  - Why: guessing branch names is unsafe; empty defaults force explicit user intent.
- Decision: only rename merge-step labels and help text, not the underlying `git_merge` step type or runtime arguments.
  - Why: the backend correctly models `git merge <from>` and does not need a behavior change.

## Risks / Trade-offs
- Risk: users may delete an auto-added variable and immediately reintroduce the same placeholder in a custom JSON step.
  - Mitigation: save-time validation remains as a strict backstop.
- Risk: storing default values in `variables_schema` may confuse older assumptions that it behaves like a JSON schema.
  - Mitigation: limit this change to the editor and keep the stored shape simple and explicit.

## Migration Plan
1. Update the workflow editor state shape from raw JSON text to variable rows.
2. Add placeholder extraction utilities and save-time validation.
3. Update built-in merge-step text and tests.
4. Verify create/edit flows and existing smoke coverage.

## Open Questions
- None after the design pass; current scope is limited to editor behavior.

