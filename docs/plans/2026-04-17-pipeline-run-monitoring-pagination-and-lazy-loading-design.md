# Pipeline Run Monitoring Pagination And Lazy Loading Design

Date: 2026-04-17
Status: confirmed for implementation

## Context

The current pipeline run monitor still loads all run history eagerly and fetches full run detail in a single request. That behavior was acceptable during the initial orchestration rollout, but it will not hold once the desktop app accumulates more pipeline history and more node-level diagnostics.

The active OpenSpec change `enhance-pipeline-runtime-and-monitoring` already defines the next required behavior:

- paginated and filterable run history
- summary-first run detail loading
- heavy node diagnostics loaded on demand

This design narrows that scope into an implementation slice that can land without redesigning the entire monitoring UI.

## Goals

- keep the run monitor responsive as history grows
- reduce the default payload size for run detail
- preserve current monitoring behavior and terminology
- keep the UI change incremental instead of rebuilding the page

## Non-Goals

- auto-refresh for active runs
- scheduler efficiency changes
- DAG, matrix, or timeline visualization
- broad filtering across every possible field

## Decision Summary

### 1. Paginated run list

The backend will stop returning the entire run history as a bare array. Instead it will return a paginated response with:

- `items`
- `page`
- `page_size`
- `total`
- `has_next_page`

The first implementation will use:

- default page size: `20`
- default page: `1`
- sort order: newest first by `updated_at` and `id`

The first implementation will support these filters only:

- `status`
- `pipeline_definition_id`
- `project_group_id`

This is the minimum useful filter set that matches actual operator workflows without over-designing the API.

### 2. Summary-first run detail

The run detail surface will be split into two layers.

Layer 1 returns:

- run summary fields
- project summary fields
- node summary fields
- wait-state summary fields already visible in the monitor

Layer 2 returns per-node heavy diagnostics:

- `stdout`
- `stderr`
- `evidence`
- `wait_context`

The summary response must be sufficient for:

- choosing a run
- scanning project states
- reading node order and summary messages
- identifying failed or waiting nodes

It must not require the heavy diagnostic payload.

### 3. On-demand node diagnostics

The frontend will request node diagnostics only when the operator expands a node card.

This keeps the UI model simple:

- the monitor still has one run list view
- the detail pane still shows projects and nodes
- each node card gains an explicit diagnostic expansion path

This is preferable to introducing a second diagnostics page or a different navigation model.

### 4. Compatibility approach

This slice will keep the old command names:

- `list_pipeline_runs`
- `get_pipeline_run_detail`

but it will change their payload shapes to fit the new paginated and summary-first model. A new command will be added for node diagnostics instead of overloading the summary response:

- `get_pipeline_run_node_diagnostics`

This keeps the desktop API focused and avoids ambiguous optional payloads in the summary endpoint.

## Data Model Changes

The Rust and TypeScript model layers will be split so the UI can tell summary data from heavy detail explicitly.

Expected model families:

- paginated run list response
- run list filter input
- run detail summary
- project summary
- node summary
- node diagnostics

The node summary model will keep the Chinese failure envelope fields because those are part of the operator-facing summary, not just low-level diagnostics.

## UI Changes

`WorkflowRunsPagePipeline.tsx` will change in these ways:

- use paginated list state instead of a plain array
- add a small filter bar for status, pipeline, and project group
- add next/previous pagination controls
- fetch run summary when a run is selected
- load node diagnostics only when a node is expanded

The page will not be visually redesigned in this slice. The goal is payload control and interaction correctness first.

## Testing Strategy

Rust tests should cover:

- paginated run list ordering and filtering
- run detail summary excluding heavy fields
- node diagnostics endpoint returning heavy payloads for a selected node

Frontend tests should cover:

- loading the paginated list
- changing page or filters
- expanding a node and requesting diagnostics lazily

## Risks And Mitigations

### Risk: breaking existing smoke tests

Mitigation:

- update the frontend invoke layer and smoke fixtures in the same slice
- keep command names stable where possible

### Risk: too much UI churn in one batch

Mitigation:

- keep filters intentionally small
- keep the existing page layout
- avoid auto-refresh in this slice

### Risk: summary and diagnostics drift apart

Mitigation:

- derive both responses from the same persisted run-node records
- keep summary fields limited to stable operator-facing state

## Recommended Implementation Order

1. add failing Rust tests for paginated run list and summary-first detail
2. add failing frontend tests for paginated invoke shape and lazy diagnostics loading
3. implement backend models and DB queries
4. implement Tauri command and TypeScript invoke changes
5. update `WorkflowRunsPagePipeline.tsx`
6. run focused verification before committing
