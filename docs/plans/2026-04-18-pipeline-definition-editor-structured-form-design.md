# Pipeline Definition Editor Structured Form Design

Date: 2026-04-18
Status: confirmed for implementation

## Context

The next unchecked OpenSpec task is `4.1`: break the pipeline definition editor into smaller editing sections and reduce dependence on raw JSON editing for built-in nodes.

The current implementation in `src/pages/WorkflowsPagePipeline.tsx` has two separate problems:

- the editor is still a large page-level state machine with most editing UI in one file
- JSON editing is still a core interaction for custom node parameters and schedule variables

This creates two kinds of friction:

- future changes to variables, nodes, or schedules keep increasing the size and coupling of one page
- operators who need nested parameters must fall back to raw JSON even when the app already knows the value structure

This slice should solve both problems together: split the editor into smaller sections and introduce a structured editor for full JSON values while keeping an advanced JSON fallback.

## Goals

- split the pipeline definition editor into smaller section components
- support structured editing for full JSON values, including objects, arrays, strings, numbers, booleans, and null
- keep an advanced JSON mode as a fallback instead of forcing raw JSON as the default path
- preserve current pipeline draft and save behavior
- keep scheduler runtime feedback in the schedule section after the refactor

## Non-Goals

- introducing a schema-driven generic form engine for the whole app
- changing backend pipeline models or command contracts
- redesigning the page layout beyond the editor sections needed for maintainability
- removing advanced JSON mode in this slice
- adding DAG, timeline, or other visualization work

## Decision Summary

### 1. Keep page-level orchestration in `WorkflowsPagePipeline.tsx`

The page should continue to own:

- create and edit dialog state
- loading, saving, and delete command calls
- draft state for create and edit flows
- schedule runtime refresh state

The page should stop owning most of the editing JSX. It becomes the container and orchestration layer, not the full editor surface.

### 2. Split the draft form into focused section components

`PipelineDraftForm` should become a thin composition layer that renders section components with explicit props.

Recommended sections:

- `PipelineBasicsSection`
- `PipelineVariablesSection`
- `PipelineNodesSection`
- `PipelineSchedulesSection`

These should live under a pipeline-editor-specific component directory so the refactor does not pollute generic UI folders with domain-specific draft logic.

### 3. Introduce one reusable structured JSON editor

Create a shared `StructuredJsonEditor` component used by:

- custom node parameters
- built-in node extra parameters
- schedule variables

It should support:

- object editing with add, remove, and key rename
- array editing with ordered items
- primitive type switching between string, number, boolean, and null
- nested composition through recursion

This should be a value editor, not a schema engine. It edits `unknown` JSON-like values directly.

### 4. Use structured mode as the default and JSON mode as a fallback

The operator default path should be structured editing.

Each structured JSON surface should also support a secondary advanced mode:

- `structured`
- `json`

The structured value remains the source of truth. JSON mode is an alternate view over the same value.

When JSON mode is active:

- the editor keeps a JSON text draft
- successful parse updates the structured value
- invalid JSON shows a local validation error
- invalid JSON must not destroy the last valid structured value

This preserves flexibility without making raw JSON the primary UX.

### 5. Built-in nodes should use hybrid editing

Built-in nodes already have known fields such as `project`, `ref`, `sha`, `branch`, and `remote`.

Those fields should continue to render as focused inputs because they are the clearest operator experience.

For built-in nodes, the editor should split parameters into:

- known built-in fields rendered as standard inputs
- extra parameters rendered by `StructuredJsonEditor`
- advanced JSON fallback for the full parameter object

This avoids making operators edit known fields through a generic JSON tree while still allowing full expressiveness.

### 6. Custom nodes should use full structured editing

Custom nodes do not have a known field schema, so the default custom-node experience should be the full structured JSON editor.

They should still expose advanced JSON mode as a fallback, but no longer default to a raw `textarea`.

### 7. Schedule variables should stop depending on `variablesText`

Schedule rows already have regular fields for target project group, cron, timezone, enabled, and policy.

The remaining JSON-heavy part is schedule variables.

This slice should make the default schedule-variable editor structured while keeping JSON mode as a fallback. The draft model may still keep JSON text as a transient view-state field if helpful for editing, but the user-facing primary path should be structured.

## Component Structure

Recommended directory:

```text
src/components/pipeline-editor/
├── PipelineDraftForm.tsx
├── PipelineBasicsSection.tsx
├── PipelineVariablesSection.tsx
├── PipelineNodesSection.tsx
├── PipelineNodeCard.tsx
├── PipelineSchedulesSection.tsx
└── StructuredJsonEditor.tsx
```

`WorkflowsPagePipeline.tsx` should import the composed draft form from this directory.

Helper functions that are still domain-specific to the draft may stay in the page file initially, but pure JSON-editor helpers should move closer to the editor component if that reduces coupling.

## State Model

The draft state can stay centered on the current `PipelineDraft` shape for this slice.

Important adjustments:

- built-in nodes still keep `parameters`
- custom node text should become editor mode state rather than the only editing path
- schedule variable JSON text should become editor mode state rather than the only editing path

The refactor should avoid introducing duplicate long-lived truths. The stable value should always be the parsed structured value; text is just an alternate editing view.

## Error Handling

Local editor validation should stay local to the section:

- invalid JSON in advanced mode shows inline error text
- invalid JSON does not overwrite the current valid structured value
- save-time validation still runs through the existing draft-to-payload path

The page-level save flow should continue to surface Chinese-first errors through existing `readCommandErrorMessage(...)` behavior.

## Testing Strategy

Add focused frontend coverage for:

- built-in node known fields still update parameter payloads correctly
- custom nodes can build nested objects and arrays through structured editing
- schedule variables can be edited structurally
- JSON mode round-trips to structured mode without losing the last valid value
- invalid JSON mode edits show local errors and do not corrupt draft values
- create and edit flows still submit the expected payload shape after the component split

This slice should remain frontend-focused. Backend runtime regression only needs a safety check through existing pipeline runtime coverage.

## Risks And Mitigations

### Risk: structured editor scope grows into a generic form engine

Mitigation:

- keep the editor value-based, not schema-based
- scope reuse to node parameters and schedule variables only

### Risk: dual-mode editing introduces synchronization bugs

Mitigation:

- treat structured value as the only persisted truth
- keep JSON mode as a derived text view with explicit parse and local error handling
- add round-trip tests before wiring all editor surfaces

### Risk: page refactor breaks create/edit parity

Mitigation:

- keep one shared draft form used by both create and edit dialogs
- add smoke coverage for both paths after the split

## Recommended Implementation Order

1. add failing frontend coverage for structured JSON editing and JSON-mode fallback behavior
2. introduce `StructuredJsonEditor` with recursive object and array editing
3. split the draft form into section components without changing behavior
4. wire built-in node hybrid editing and custom node structured editing
5. wire schedule variable structured editing
6. run frontend, runtime, and OpenSpec verification
