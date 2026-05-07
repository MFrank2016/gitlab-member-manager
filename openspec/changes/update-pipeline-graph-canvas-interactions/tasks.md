## 1. Graph Interaction Model
- [ ] 1.1 Add stable stage and node left-click selection that keeps the inspector synchronized with the selected canvas object.
- [ ] 1.2 Add stage and node right-click menus with only the approved actions, and make those actions target the right-clicked stage or node without changing current selection just because the menu opened.
- [ ] 1.3 Add a create-node dialog that validates required node fields before writing a new node into the draft.

## 2. Layout And Dragging
- [ ] 2.1 Replace stage-internal free placement with deterministic grid-slot layout helpers, stage auto-sizing, and stage-local node reflow.
- [ ] 2.2 Restrict stage dragging to horizontal sorting and keep node dragging inside the current stage only.
- [ ] 2.3 Persist stage order and stage-local grid-slot positions through the `PipelineDraft` path and reconstruct the same layout on reload.
- [ ] 2.4 Keep blank-canvas clicks, menu-driven delete targeting, and fallback-selection behavior aligned with the new interaction model.

## 3. Verification
- [ ] 3.1 Add or update focused graph-model tests for grid layout, stage sizing, reflow behavior, and persisted stage-order plus slot-position reconstruction.
- [ ] 3.2 Add or update focused editor tests for selection, right-click menu targeting, create-node validation, delete fallback behavior, and drag behavior.
- [ ] 3.3 Add or update page-level smoke coverage for the canvas authoring flow, including draft reload with reconstructed stage order and stage-local grid layout.
- [ ] 3.4 Validate this OpenSpec change with `openspec validate update-pipeline-graph-canvas-interactions --strict`.
