# Pipeline Schedule Runtime Feedback Design

Date: 2026-04-17
Status: confirmed for implementation

## Context

The scheduler efficiency slice is now landed, and the next unchecked OpenSpec task is `3.2`: add clearer schedule-state feedback, including queued, skipped, and next-trigger visibility.

Today the scheduler has the internal data required to make decisions, but operators cannot see those decisions anywhere in the product:

- the scheduler loop knows when a schedule was started, queued, or skipped
- the pipeline definition editor already owns the schedule rows
- no backend model currently exposes runtime scheduler feedback
- no frontend view currently renders queued, skipped, or next-trigger information

The first implementation should expose scheduler runtime state without changing desktop-only scheduling semantics or introducing a new persistence table.

## Goals

- expose schedule runtime feedback through a stable backend model
- show queued, skipped, and next-trigger visibility for each schedule
- add the first UI entry point in the pipeline definition editor
- keep current scheduler behavior unchanged

## Non-Goals

- persisting scheduler feedback into SQLite
- building a dedicated scheduler dashboard in this slice
- adding background-service scheduling or missed-run replay
- changing pipeline execution semantics

## Decision Summary

### 1. Introduce a lightweight runtime snapshot model

Add a scheduler runtime snapshot keyed by `schedule_id` with these fields:

- `scheduleId`
- `queued`
- `lastDecision`
- `lastDecisionAt`
- `lastDecisionMessageZh`
- `nextTriggerAt`

`lastDecision` will use the smallest useful enum:

- `started`
- `queued`
- `skipped`
- `idle`

This covers the OpenSpec requirement without expanding into a full event log.

### 2. Store feedback in scheduler memory, not the database

`SchedulerState` should gain a `schedule_feedback` map keyed by `schedule_id`.

The scheduler updates it whenever a tick makes a visible decision:

- successful start -> `started`
- queue-after-running enqueued -> `queued`
- skip-if-running skipped -> `skipped`

This keeps the feature within the current desktop-local scheduler model and avoids unnecessary schema churn.

### 3. Compute next-trigger timestamps on read

`nextTriggerAt` should be derived from the current schedule definition (`cron_expr` + `timezone`) when the runtime snapshot command is called.

It should not be stored in memory or SQLite because:

- it is deterministic from existing definition data
- it avoids invalidation logic when a definition is edited
- it keeps the runtime feedback state focused on actual scheduler decisions

### 4. Add one read-only command for frontend reuse

Expose a Tauri command that returns schedule runtime snapshots for a pipeline definition.

The command should:

- load the definition schedules from storage
- ask the scheduler runtime for in-memory feedback by `schedule_id`
- calculate `nextTriggerAt`
- return one snapshot per schedule

This gives both the definition page and any future monitor page a shared source of truth.

### 5. First frontend entry lives in the definition editor

The first UI entry point should be the schedule section in `WorkflowsPagePipeline.tsx`.

For each schedule row, show:

- next trigger
- current runtime state
- Chinese explanation text

The first implementation should use a manual refresh action instead of auto-refresh. That keeps the slice small and avoids introducing another polling loop immediately after `2.3`.

## Implementation Notes

The cleanest split is:

- `scheduler.rs`: runtime feedback state, next-trigger helper, and snapshot assembly
- `models.rs`: snapshot output type
- `main.rs`: read-only command surface
- `invoke.ts` / `types.ts`: frontend contract
- `WorkflowsPagePipeline.tsx`: minimal schedule feedback rendering and refresh button

The feedback map should be best-effort and in-memory only. After app restart, schedules will naturally report:

- `queued = false`
- `lastDecision = idle`
- `lastDecisionAt = null`
- `lastDecisionMessageZh = null`

That is acceptable for this slice because `3.3` explicitly keeps desktop scheduler semantics unchanged.

## Testing Strategy

Add focused coverage for:

- scheduler feedback snapshot returns `queued` and `skipped` after matching ticks
- next-trigger calculation returns the expected future timestamp
- definition page renders schedule runtime feedback text from the command response

Keep runtime and scheduler regressions green after the new snapshot layer is introduced.

## Risks And Mitigations

### Risk: feedback state drifts from actual queued requests

Mitigation:

- update `schedule_feedback` only in the same branches that mutate queueing or starts
- derive `queued` from live queued requests when building snapshots if needed for consistency

### Risk: next-trigger calculation disagrees with actual scheduler matching

Mitigation:

- reuse the same cron parser and timezone handling rules already used in scheduler tick matching
- add a focused test for a concrete cron/timezone example

### Risk: front-end scope expands into a second monitoring surface

Mitigation:

- limit the first UI entry to the definition editor schedule rows
- use manual refresh only in this slice

## Recommended Implementation Order

1. add failing Rust tests for next-trigger and runtime feedback snapshots
2. add the scheduler runtime snapshot model and command
3. add failing frontend coverage for schedule runtime feedback rendering
4. implement the definition-page status block and manual refresh action
5. run focused scheduler, runtime, frontend, and OpenSpec verification
