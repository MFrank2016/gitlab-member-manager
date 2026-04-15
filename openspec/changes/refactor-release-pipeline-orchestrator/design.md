## Context
The existing application already has a local-first workflow engine built around `workflow_definitions`, `workflow_steps`, and `workflow_runs`. That engine is good enough for ordered local Git steps, but the new release use cases require GitLab-aware gates, waiting semantics, scheduled execution, and Chinese-facing operational feedback. The redesign in `docs/plans/2026-04-10-release-pipeline-orchestrator-redesign-design.md` is the source design for this change.

## Goals / Non-Goals
- Goals:
  - replace the workflow-centric runtime with a unified `pipeline_*` model
  - keep ordered built-in nodes and pipeline-level variables as the primary authoring model
  - support GitLab pipeline check, wait, and trigger nodes
  - support manual runs, desktop-bound scheduled runs, and derived reruns
  - surface structured Chinese failure summaries with raw technical evidence
  - migrate existing workflow definitions and run history without manual rebuilds
- Non-Goals:
  - no arbitrary PowerShell or shell script execution in v1
  - no DAG editor in v1; pipeline nodes remain linear and ordered
  - no automatic notification delivery in v1
  - no system-service scheduler; scheduled execution only works while the desktop app is open
  - no in-place resume from the middle of a failed run; reruns are always derived runs

## Decisions
- Decision: introduce `pipeline_*` tables and runtime objects alongside the legacy `workflow_*` data for one transition release.
  - Why: the new release model is broader than the current workflow model, and a transition window avoids data loss while the new UI and command surface stabilize.
- Decision: make `pipeline_*` the only writable source of truth once migration succeeds.
  - Why: dual writes would create consistency drift. Legacy tables can remain read-only during the transition window.
- Decision: keep the authoring model as ordered built-in nodes plus pipeline-level variables and schedules.
  - Why: this covers the requested release cases while staying far easier to validate and support than arbitrary scripting or DAG authoring.
- Decision: reuse the current workflow editor and run-monitor surfaces as the migration path to pipeline UI.
  - Why: the repo already contains working pages, tests, and invoke wiring that can be evolved incrementally instead of replaced all at once.
- Decision: persist waiting-state metadata and structured Chinese error envelopes in the run model.
  - Why: release operations need auditability and operator guidance, not just raw stderr or HTTP bodies.
- Decision: `wait_pipeline` must prefer a commit-specific pipeline match when prior nodes produced commit context.
  - Why: waiting on the latest branch pipeline is unsafe once other pushes arrive on the same branch.

## Risks / Trade-offs
- Risk: a transition window means the codebase temporarily understands both `workflow_*` and `pipeline_*`.
  - Mitigation: keep all new writes on `pipeline_*`, make migration idempotent, and document the removal criteria for the legacy path.
- Risk: scheduled execution can look unreliable if the desktop app is closed.
  - Mitigation: surface the desktop-open limitation clearly in UI copy and avoid promising missed-run backfill in v1.
- Risk: GitLab polling can create noisy logs or unclear waiting behavior.
  - Mitigation: persist the last observed state, target identifiers, next poll time, and elapsed wait duration so the UI can explain what is happening.

## Migration Plan
1. Add the new `pipeline_*` tables, models, and persistence helpers without removing the old schema.
2. Implement an idempotent migration pass that maps legacy workflow definitions, variables, steps, and runs into the new model without duplicating already migrated records.
3. Switch definition edits, manual runs, schedule creation, and rerun actions to write only to `pipeline_*`.
4. Keep legacy workflow data available in read-only form for at least one release window while the new pipeline UI settles.
5. Hide legacy workflow entry points only after migrated records and the new pipeline UI are verified in production-like usage.

## Open Questions
- Whether the transition mapping needs explicit legacy-to-pipeline ID tracking tables or whether stable uniqueness constraints are enough.
- Whether project-to-project dependency gates should stay implicit in ordered nodes or gain explicit metadata in a later phase.
- Whether future versions should add notification adapters after the pipeline runtime stabilizes.
