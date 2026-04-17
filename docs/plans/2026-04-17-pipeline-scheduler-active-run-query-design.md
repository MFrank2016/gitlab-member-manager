# Pipeline Scheduler Active-Run Query Design

Date: 2026-04-17
Status: confirmed for implementation

## Context

The monitoring slices are now landed, and the next unchecked OpenSpec task is `3.1`: improve scheduler tick efficiency so active-run checks do not scale as one database query per schedule.

Today the scheduler does two kinds of repeated lookups:

- `run_scheduler_tick(...)` calls `count_active_pipeline_runs(...)` for every due schedule
- `drain_ready_queue(...)` calls the same query for every queued schedule request

This preserves behavior, but it means the database work for a single tick scales with the number of due schedules and queued requests.

## Goals

- reduce active-run lookup cost from repeated per-schedule queries to a single grouped query per tick
- preserve current scheduler semantics for `allow_parallel`, `skip_if_running`, and `queue_after_running`
- keep the scheduler desktop-local and timer-driven
- avoid changing user-visible behavior or introducing new frontend work

## Non-Goals

- changing scheduler cadence or moving it into a background service
- adding new operator-facing schedule state output
- reworking queue persistence or schedule definitions

## Decision Summary

### 1. Load active-run counts once per tick

Add a database helper that returns grouped active-run counts by `pipeline_definition_id` for the scheduler-relevant pipeline definitions.

The query should treat these statuses as active:

- `pending`
- `running`
- `cancelling`

This converts repeated `COUNT(*)` lookups into one grouped read.

### 2. Maintain counts in memory during the tick

Once the tick has the initial `HashMap<pipeline_definition_id, active_count>`, it should mutate that map as runs start successfully during the same tick.

That is required to preserve current behavior. Under the old implementation, later schedules in the same tick would observe earlier inserts because each policy branch re-queried the database. The new implementation must preserve that effect by incrementing the in-memory count after each successful start.

### 3. Share the same count map with queue draining

`drain_ready_queue(...)` should receive the mutable count map instead of querying the database itself.

This ensures the queue-drain phase and due-schedule phase agree on the same active-run view for the current tick.

### 4. Keep policy semantics unchanged

The optimization must not change what the scheduler decides:

- `allow_parallel` still starts immediately
- `skip_if_running` still skips when active count is greater than zero
- `queue_after_running` still queues once and avoids duplicate queued requests

Only the lookup strategy changes.

## Implementation Notes

The cleanest split is:

- `db.rs`: add a grouped helper for active pipeline run counts
- `scheduler.rs`: replace direct per-schedule count queries with a tick-scoped mutable map
- tests: cover both the new helper and the scheduler behavior when multiple schedules share one pipeline definition

The important edge case is multiple due schedules that point to the same pipeline definition within the same tick. If the in-memory map is not incremented after the first start, `skip_if_running` and `queue_after_running` can make the wrong decision for the later schedule.

## Testing Strategy

Add focused Rust tests for:

- grouped active-run counts returning only active statuses
- same-tick scheduling against one pipeline definition still respecting `skip_if_running`
- existing scheduler regression suite remaining green

No frontend test is needed for `3.1`.

## Risks And Mitigations

### Risk: stale in-memory counts within the tick

Mitigation:

- increment the relevant count immediately after every successful scheduled start
- share one mutable map across queue draining and due schedule processing

### Risk: semantic regression when multiple schedules target one definition

Mitigation:

- add a dedicated scheduler regression test for shared-definition schedules in the same tick

### Risk: unnecessary complexity in SQL

Mitigation:

- keep the helper narrow: grouped counts only, limited to scheduler-relevant pipeline definition ids

## Recommended Implementation Order

1. add failing Rust coverage for the new grouped count helper
2. add shared-definition scheduler regression coverage
3. implement grouped count loading in `db.rs`
4. thread a mutable count map through queue draining and scheduler tick execution
5. run focused scheduler and runtime verification
