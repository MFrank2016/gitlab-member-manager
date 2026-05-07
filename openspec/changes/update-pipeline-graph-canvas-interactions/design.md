## Context
The current React Flow based pipeline editor already renders stage groups, action nodes, and dependency edges, but its interaction layer is still inconsistent. Stage and node clicks do not reliably drive the inspector, the canvas does not expose local context actions, node creation can introduce incomplete data too early, and stage-internal layout degrades as more nodes are added.

The approved scope is narrower than a full editor rewrite. This change keeps `PipelineDraft`, the current stage-group and child-node model, and the existing inspector structure, while making the canvas predictable enough for real authoring work.

## Goals / Non-Goals
- Goals:
  - Add stable left-click selection for stages and nodes.
  - Add stage and node right-click menus with the approved actions only.
  - Add a stage-scoped create-node dialog with strict required-field validation.
  - Introduce stage-local grid layout, stage container auto-sizing, and deterministic node reflow.
  - Restrict stage dragging to horizontal sorting and keep node dragging stage-local.
- Non-Goals:
  - Rewrite the pipeline editor around a different canvas library.
  - Introduce freeform stage placement or cross-stage node dragging.
  - Add bulk selection, batch actions, or automatic edge-routing work in this change.
  - Change pipeline runtime semantics beyond what is needed to persist the updated authoring layout.

## Decisions
- Decision: keep `PipelineDraft` as the single persisted source of truth and store selection, context-menu, and create-node dialog state locally in the editor.
  - Why: those interaction states are ephemeral and should not pollute the saved pipeline definition.

- Decision: treat left-click as selection plus inspector focus, and treat right-click as context-menu opening only.
  - Why: the user-approved interaction model depends on predictable editing selection and on context actions that do not silently change persisted data.

- Decision: treat blank-canvas clicks and delete flows as explicit selection-lifecycle events.
  - Why: the editor needs stable fallback behavior. Blank-canvas left-click clears the visible selection and resets the inspector to its empty state, while deleting the selected object falls back to the most recent remaining valid selection or to the empty state if none remain.

- Decision: create nodes only through a stage-scoped dialog that validates node type and required fields before mutation.
  - Why: incomplete placeholder nodes make the draft harder to reason about and create avoidable save-time failures.
  - Interaction boundary: right-click opens a stage or node context menu without changing the current selection on its own, while successful node creation immediately selects the new node and moves the inspector into node editing.

- Decision: represent stage-internal layout as deterministic grid slots with reserved whitespace and content-driven container sizing.
  - Why: arbitrary free placement makes node overlap and connection crowding harder to control, while slot-based layout supports predictable reflow after drag operations.
  - Persistence boundary: the persisted source of truth is the `PipelineDraft` representation derived from stage order and stage-local slot positions, so reload reconstructs the same grid ordering and stage sizing instead of depending on transient DOM coordinates.

- Decision: constrain drag behavior to stage-local node reordering and horizontal stage sorting.
  - Why: the approved v1 scope wants predictable reorder semantics, not a fully freeform canvas.

## Risks / Trade-offs
- Risk: slot-based reflow may feel less flexible than freeform placement.
  - Mitigation: keep reflow deterministic, scoped to the current stage, and visually spaced for connections.

- Risk: stricter create-time validation surfaces more errors earlier.
  - Mitigation: keep validation feedback inside the dialog and avoid mutating the draft until validation succeeds.

- Risk: selection and drag state can drift if they depend on rendered coordinates instead of stable identifiers.
  - Mitigation: normalize editor-local state around `stageKey` and `nodeKey`, and always rebuild the rendered graph from `PipelineDraft`.

## Migration Plan
1. Extend the graph-model helpers to compute stage-local grid slots, stage auto-sizing, and reflow outputs.
2. Add editor-local selection, context-menu, and create-node dialog state and wire stage and node click events into it.
3. Route node creation through the validated dialog and keep inspector transitions synchronized with the selected object.
4. Restrict drag handling to stage sort and stage-local node reflow, then backfill focused component and smoke coverage.

## Open Questions
- None for the currently approved v1 scope.
