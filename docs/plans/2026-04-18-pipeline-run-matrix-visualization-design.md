# Pipeline Run Matrix Visualization Design

Date: 2026-04-18
Status: confirmed for implementation

## Context

The next unchecked OpenSpec task is `4.2`: add richer pipeline run visualizations such as DAG, project-by-node matrix, or timeline views for operator troubleshooting.

After the previous slices, the current run monitor in `src/pages/WorkflowRunsPagePipeline.tsx` already has the data needed for a first visualization slice:

- paginated run list for run selection
- summary-first run detail loading
- per-project node arrays with status, summary, wait metadata, and Chinese failure envelope fields
- lazy-loaded node diagnostics below the selected project

The current operator surface is still mostly table and card based:

- a run list on the left
- a project status table on the right
- node cards for one selected project

This is workable, but it still makes cross-project troubleshooting too slow. Operators must scan the project table, then drill into one project at a time to figure out where a failure or waiting state happened.

The roadmap acceptance criteria in `docs/plans/2026-04-16-two-month-evolution-roadmap.md` are explicit:

- at least one pipeline-suitable graphical run view should be online
- operators should quickly identify which project failed
- operators should quickly identify which node failed
- operators should quickly identify whether a run is waiting on a remote pipeline

The first `4.2` slice should satisfy those goals with the smallest change that fits the current data model.

## Goals

- ship one operator-facing visualization that is meaningfully better than the current table-only view
- make cross-project failure and waiting-state identification faster inside the existing run monitor
- reuse current frontend data without adding new backend commands or payload shapes
- keep the existing project table and node detail path available during the first slice
- preserve Chinese-first labels and status messaging

## Non-Goals

- building a full DAG renderer in this slice
- building a full run timeline with precise duration bars in this slice
- adding new backend APIs only to support the first visualization
- replacing the existing project list and node detail views entirely
- introducing external charting or graph libraries
- implementing schedule preview in this slice

## Decision Summary

### 1. Choose project-by-node matrix as the first visualization

The first slice should be a project-by-node matrix, not a DAG and not a single-project timeline.

Reasoning:

- the current data model already gives every project a node list with `nodeOrder`, `nodeType`, `status`, `summaryMessage`, and wait metadata
- the roadmap success criteria are about fast cross-project diagnosis, which a matrix answers directly
- a DAG would look visually richer but current frontend data is node-order based, not dependency-edge based
- a timeline helps only after a single project is already selected; it does not solve the cross-project scan problem first

The matrix is therefore the highest-signal and lowest-risk first cut.

### 2. Add the matrix alongside the existing project table, not as a replacement

The current "project status" panel should become a small two-mode surface:

- `list`
- `matrix`

`list` remains the default-safe fallback and keeps current behavior intact.

`matrix` becomes the new visualization mode. This avoids replacing a proven interaction path while still letting operators use the denser view immediately.

This also makes the first slice safer:

- no forced migration of the operator workflow
- easier smoke coverage
- lower risk of hiding useful textual summary data

### 3. Keep node diagnostics in the existing lower detail panel

The first matrix slice should not try to render every node log or failure explanation inside the matrix itself.

The matrix should answer:

- where is the problem
- which projects are affected
- whether the issue is waiting, skipped, failed, or successful

The existing node detail panel below should continue to answer:

- what exactly happened in the selected project
- what Chinese title/detail/suggestion was recorded
- what evidence, stderr, stdout, or wait context exists

This keeps the matrix dense and readable instead of turning it into a log viewer.

### 4. Reuse current page state and detail payloads

The matrix should be powered only by `selectedRunDetail.projects[].nodes[]`.

The first slice should reuse existing page state:

- `selectedRunDetail`
- `selectedProjectId`
- `loadingDetail`
- existing run selection and auto-refresh behavior

No new backend fetch should be required for the matrix itself.

### 5. Matrix cells should remain status-first, with small wait/failure hints

Each cell represents one project at one pipeline node.

The primary signal should be cell status color and short Chinese status text.

Secondary hints can include:

- short summary text when present
- waiting target and latest remote status for wait nodes
- remote pipeline ID when available

These hints should stay compact. Full evidence still belongs in the detail panel.

## Approaches Considered

### Approach A: DAG-first

Pros:

- visually strongest at first glance
- aligns with the roadmap wording about DAG

Cons:

- current frontend data does not expose true dependency edges
- easy to build a decorative graph that does not improve troubleshooting
- higher UI and testing complexity for a first slice

Decision: not chosen for the first slice.

### Approach B: Project-by-node matrix first

Pros:

- directly supported by current payloads
- answers cross-project troubleshooting questions well
- low backend risk
- easy to keep current detail workflow intact

Cons:

- less visually novel than a DAG
- can become wide on long pipelines, so horizontal scrolling is required

Decision: chosen.

### Approach C: Single-project timeline first

Pros:

- straightforward extension of current node card view
- good for one-project deep dives

Cons:

- does not solve the first operator problem, which is cross-project comparison
- duplicates value already partially present in the node detail stack

Decision: keep as a likely second visualization after the matrix.

## UX Structure

## Run Monitor Layout

The left-side run list and top-level run summary remain unchanged.

The right-side upper panel changes from one project table into a view switcher:

- `list`: current project table
- `matrix`: new project-by-node matrix

The lower panel remains the selected-project node detail area.

Recommended interaction model:

- selecting a project row in `list` keeps current behavior
- clicking a matrix row header selects that project
- clicking a matrix cell also selects that project
- after selection, the lower detail panel continues to show node cards for that project

This gives the matrix a clean drill-down story without adding a new selected-node state in the first slice.

## Matrix Model

### Columns

Columns should be derived from the union of node definitions present in `selectedRunDetail.projects`.

Use a stable column key based on:

- `nodeOrder`
- `pipelineNodeId` when available
- fallback `nodeType`

Each column header should show:

- node order
- Chinese node label from the existing `NODE_TYPE_TEXT`

### Rows

Each row represents one project and should show:

- project name
- project overall status
- one cell per matrix column

Rows should stay aligned with the current selected project behavior.

### Cells

Each cell represents the node execution snapshot for one project at one node.

Cell content priority:

1. status color
2. short Chinese status text
3. small wait/failure hint if useful

Missing cells should render as a muted placeholder rather than collapsing the table.

## Component Structure

Recommended additions:

```text
src/components/pipeline-run-monitor/
- PipelineRunProjectMatrix.tsx
- matrix-model.ts
```

Recommended integration point:

- `src/pages/WorkflowRunsPagePipeline.tsx` owns the view mode state and selected project state
- `PipelineRunProjectMatrix.tsx` receives already-loaded project data plus selection callbacks
- `matrix-model.ts` contains projection helpers so matrix rendering and tests do not rely on JSX-only logic

This keeps `WorkflowRunsPagePipeline.tsx` from growing again while `4.2` lands.

## Error Handling

The matrix itself should not add new error states beyond current page behavior.

Rules:

- if run detail is loading, the panel keeps the current loading state text
- if no run is selected, the panel keeps the current empty state text
- if project data is missing for some node, render a muted placeholder cell instead of crashing
- all labels and operator prompts remain Chinese-first

## Testing Strategy

Add focused frontend coverage for:

- matrix model builds stable columns from run detail data
- matrix renders failed and waiting states with the expected Chinese labels
- clicking a matrix row or cell selects the correct project
- switching between `list` and `matrix` keeps project selection and existing detail behavior intact
- waiting nodes surface remote wait hints without requiring diagnostics expansion

This slice should remain frontend-only. Existing Rust runtime coverage is enough as a safety check because backend contracts should not change.

## Risks And Mitigations

### Risk: matrix widens too much on long pipelines

Mitigation:

- make the matrix horizontally scrollable
- keep cell content compact
- do not attempt rich multi-line logs inside cells

### Risk: matrix duplicates too much of the current project table

Mitigation:

- keep the table as fallback
- use matrix only for the new dense status projection
- preserve drill-down into the existing detail panel

### Risk: `WorkflowRunsPagePipeline.tsx` starts growing again

Mitigation:

- extract the visualization into a dedicated monitor component
- move column and row projection logic into a helper module

### Risk: first slice expands into DAG/timeline work

Mitigation:

- explicitly scope this slice to matrix plus integration
- leave DAG and timeline for later follow-up slices

## Recommended Implementation Order

1. add failing frontend coverage for matrix projection and selection behavior
2. add a small matrix model helper for stable column/row projection
3. build `PipelineRunProjectMatrix`
4. wire a `list / matrix` toggle into `WorkflowRunsPagePipeline.tsx`
5. verify smoke coverage, pipeline runtime safety coverage, and OpenSpec validation
