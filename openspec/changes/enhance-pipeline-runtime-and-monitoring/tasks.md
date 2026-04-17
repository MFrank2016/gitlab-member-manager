## 1. Runtime Foundation
- [x] 1.1 Split the pipeline runtime into smaller modules with stable boundaries for Git execution, GitLab execution, failure classification, retry logic, and legacy workflow compatibility.
- [x] 1.2 Reduce `src-tauri/src/main.rs` to a thinner command layer and introduce structured runtime error categories instead of string-only command failures.
- [x] 1.3 Preserve current runtime behavior with focused regression coverage while the internal refactor lands.

## 2. Monitoring And Data Loading
- [x] 2.1 Add paginated and filterable pipeline run history queries and update the frontend invoke surface accordingly.
- [x] 2.2 Split pipeline run detail loading into summary-first data and on-demand heavy detail such as node logs and technical evidence.
- [x] 2.3 Add active-run auto-refresh behavior in the run monitor and stop refreshing automatically once runs are terminal.

## 3. Scheduler And Operator Feedback
- [ ] 3.1 Improve scheduler tick efficiency so active-run checks do not scale as one database query per schedule.
- [ ] 3.2 Add clearer schedule-state feedback, including queued, skipped, and next-trigger visibility.
- [ ] 3.3 Keep desktop-only scheduler semantics unchanged unless explicitly expanded in a later change.

## 4. Visualization And UX
- [ ] 4.1 Break the pipeline definition editor into smaller editing sections and reduce dependence on raw JSON editing for built-in nodes.
- [ ] 4.2 Add richer pipeline run visualizations such as DAG, project-by-node matrix, or timeline views for operator troubleshooting.
- [ ] 4.3 Preserve Chinese-first operator messaging for failures, waiting states, and recovery prompts.

## 5. Verification
- [x] 5.1 Validate the change with `openspec validate enhance-pipeline-runtime-and-monitoring --strict`.
- [x] 5.2 Run focused Rust, frontend, and scheduler regression coverage for runtime foundation changes.
- [ ] 5.3 Re-run full packaging verification after monitoring and runtime changes stabilize.
