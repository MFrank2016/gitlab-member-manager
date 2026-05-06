## 1. Graph Interaction Model
- [ ] 1.1 Add stable stage and node left-click selection that keeps the inspector synchronized with the selected canvas object.
- [ ] 1.2 Add stage and node right-click menus with only the approved actions for adding nodes or deleting the selected object.
- [ ] 1.3 Add a create-node dialog that validates required node fields before writing a new node into the draft.

## 2. Layout And Dragging
- [ ] 2.1 Replace stage-internal free placement with deterministic grid-slot layout helpers, stage auto-sizing, and stage-local node reflow.
- [ ] 2.2 Restrict stage dragging to horizontal sorting and keep node dragging inside the current stage only.
- [ ] 2.3 Keep blank-canvas, delete, and fallback-selection behavior aligned with the new interaction model.

## 3. Verification
- [ ] 3.1 Add or update focused graph-model tests for grid layout, stage sizing, and reflow behavior.
- [ ] 3.2 Add or update focused editor tests for selection, context menus, create-node validation, and drag behavior.
- [ ] 3.3 Add or update page-level smoke coverage for the canvas authoring flow.
- [ ] 3.4 Validate this OpenSpec change with `openspec validate update-pipeline-graph-canvas-interactions --strict`.
