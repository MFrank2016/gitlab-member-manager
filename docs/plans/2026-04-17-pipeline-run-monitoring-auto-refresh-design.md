# Pipeline Run Monitoring Auto-Refresh Design

Date: 2026-04-17
Status: confirmed for implementation

## Context

The pipeline run monitor now supports paginated history, summary-first detail loading, and lazy node diagnostics. The remaining monitoring gap in the current OpenSpec slice is `2.3`: active pipeline runs still require manual refresh even though the UI already knows which run is selected and whether it is terminal.

This design adds automatic refresh without turning the monitor into a constantly polling dashboard.

## Goals

- automatically refresh the selected active pipeline run
- stop refreshing once the selected run becomes terminal
- preserve the current list/detail interaction model
- avoid unnecessary backend changes

## Non-Goals

- refreshing every visible run independently
- adding scheduler-driven push updates or event streaming
- changing pagination, filters, or diagnostics payload shapes

## Decision Summary

### 1. Refresh only the selected active run

Auto-refresh will activate only when the currently selected run is in one of these states:

- `pending`
- `running`
- `waiting`
- `cancelling`

If no run is selected, or the selected run is terminal, the monitor does not poll.

This keeps the behavior aligned with what the operator is actively inspecting.

### 2. Reuse the existing list refresh path

The monitor will continue to use `refreshRuns(selectedRunId, runPage.page, filters)` as the single refresh entry point.

That means each auto-refresh tick will:

- refresh the current paginated list page
- preserve the selected run when possible
- trigger detail reload for the selected run through the existing state flow

This is intentionally less clever than separate list/detail refresh channels, because it keeps the state machine simpler and avoids divergence between list status and detail status.

### 3. Fixed interval for the first implementation

The first implementation will use a fixed `10s` polling interval.

Reasons:

- easy to reason about
- good enough for desktop operator monitoring
- low implementation risk compared with adaptive or multi-speed polling

### 4. Preserve expanded diagnostics state

Auto-refresh must not collapse the operator's current node-diagnostics view.

The page should:

- preserve which nodes are expanded
- preserve already loaded diagnostics
- only clear diagnostics when the selected run changes

This avoids a frustrating loop where the operator expands a failed node and the next tick resets the view.

### 5. Stop conditions

Polling must stop when any of the following become true:

- the selected run becomes terminal
- the selected run disappears from the current filtered page
- the page unmounts
- the user changes filters or page and no active selected run remains

## Implementation Notes

The current monitor already has the right primitives:

- `selectedRun`
- `runPage`
- `filters`
- `refreshRuns(...)`
- `detailReloadVersion`

The new code only needs:

- an `isActiveRunStatus(...)` helper
- one `useEffect` that owns the polling interval
- small guard logic so diagnostics state is preserved across auto-refresh

No backend change is required for `2.3`.

## Testing Strategy

Frontend tests should prove:

- active selected runs trigger repeated refresh
- terminal selected runs do not auto-refresh
- auto-refresh preserves expanded diagnostics state

Rust verification remains regression-only for this slice because the behavior is frontend-driven.

## Risks And Mitigations

### Risk: overlapping refresh requests

Mitigation:

- reuse the existing request token guard inside `refreshRuns`
- let each tick call the same guarded refresh entry point

### Risk: polling while the user changes selection or filters

Mitigation:

- derive polling from the latest selected run and current page/filter state
- let effect teardown clear the interval immediately on dependency changes

### Risk: diagnostics collapsing on every tick

Mitigation:

- stop resetting diagnostics during detail reload unless the selected run id changes

## Recommended Implementation Order

1. add failing frontend tests for active run polling and terminal stop
2. update `WorkflowRunsPagePipeline.tsx` polling effect and diagnostics reset logic
3. run focused frontend smoke
4. run existing Rust runtime regression for confidence
