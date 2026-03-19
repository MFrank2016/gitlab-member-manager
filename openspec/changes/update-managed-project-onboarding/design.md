## Context
The app is a local-first Tauri desktop tool that already persists GitLab credentials and managed projects in SQLite. The current managed-project form is fully manual, which makes project onboarding error-prone. The repository also already exposes GitLab project search from the backend, so the new flow can reuse existing API plumbing instead of adding a separate import subsystem.

## Goals / Non-Goals
- Goals:
  - let users search GitLab projects while creating a managed project
  - prefill managed-project drafts from the selected GitLab project
  - add persistent global defaults for local repository root, default branch, and default remote
  - use a native directory picker for local repository paths
  - keep every populated field editable
  - stay backward compatible with existing config rows
- Non-Goals:
  - no auto-cloning or repository creation
  - no forced lock-down of the prefilled fields
  - no automatic path uniquifying when the computed path already exists

## Decisions
- Decision: extend the existing config JSON instead of adding a new settings table.
  - Why: the app already stores GitLab config as a single JSON blob, and the new defaults fit that model cleanly.
- Decision: make GitLab project selection overwrite the draft on each selection change.
  - Why: the user explicitly wants reselection to repopulate the form, which keeps the draft aligned with the current project choice.
- Decision: use a native directory picker for repo paths.
  - Why: it reduces Windows path entry mistakes and fits the desktop UX better than free-text input alone.
- Decision: compute the repo path suggestion from `localRepoRoot + projectName`, but do not invent a new path if the computed directory already exists.
  - Why: the user wants existing paths preserved rather than renamed or uniquified.

## Risks / Trade-offs
- Risk: project reselection can overwrite manual edits.
  - Mitigation: this is intentional and should be visible in the UI as an explicit selection action.
- Risk: the directory picker adds Tauri permission and dependency work.
  - Mitigation: keep the permission scope narrow and use the standard dialog plugin only for directory selection.
- Risk: older config rows will not contain the new keys.
  - Mitigation: load missing keys with defaults so existing users are not blocked by migration.

## Migration Plan
1. Extend config read/write logic to include the new managed-project defaults.
2. Update the settings page to edit those defaults.
3. Rework the managed-project form to support GitLab search and directory picking.
4. Add tests for draft prefilling, reselection behavior, and config fallback.

## Open Questions
- None after the brainstorming pass; the desired behavior is now narrow enough to implement directly.
