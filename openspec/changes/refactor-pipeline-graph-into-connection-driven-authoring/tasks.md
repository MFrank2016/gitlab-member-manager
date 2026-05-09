## 1. OpenSpec Alignment
- [ ] 1.1 Document the approved connection-driven interaction model as a new change that supersedes the current v1 canvas-interaction proposal instead of stretching it.
- [ ] 1.2 Validate the new change with `openspec validate refactor-pipeline-graph-into-connection-driven-authoring --strict`.

## 2. Layout And Authoring Model
- [ ] 2.1 Add a pure connection-driven layout engine that places direct successors vertically, centers parents against successor groups, and keeps stage content centered.
- [ ] 2.2 Replace stage-scoped add-node entry points with output-anchor driven successor creation, including an empty-stage start anchor and preview-edge flow.
- [ ] 2.3 Support cross-stage drag reassignment, automatic stage order recomputation from dependencies, and rollback when the resulting graph would become illegal.

## 3. Verification
- [ ] 3.1 Update graph-model and editor tests so pure logic uses `node` and DOM suites remain stable under the supported DOM environment.
- [ ] 3.2 Cover the new page-level authoring flow from empty-stage start through successor creation, cross-stage drag, and save/reload.
- [ ] 3.3 Re-run targeted graph suites plus full `pnpm test` before implementation checkpoints are declared complete.

