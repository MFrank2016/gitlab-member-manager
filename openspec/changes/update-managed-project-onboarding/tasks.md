## 1. Settings and Defaults
- [x] 1.1 Extend persisted config data to include local repository root, default branch, and default remote.
- [x] 1.2 Add the new fields to the settings page and load defaults safely when older config data is missing.

## 2. Managed Project Onboarding
- [x] 2.1 Add GitLab project search to the managed-project create flow.
- [x] 2.2 Refill project-derived fields and recompute the repo path every time a project is selected.
- [x] 2.3 Replace manual repo-path entry with a native directory picker while keeping the field editable.

## 3. Verification
- [x] 3.1 Add or update tests for config fallback, draft repopulation, and path picker behavior.
- [x] 3.2 Run `openspec validate update-managed-project-onboarding --strict`, `pnpm test`, `pnpm build`, and `cargo test -j 1`.
