# Change: Improve managed project onboarding

## Why
Creating a managed project currently relies on manual entry for GitLab metadata and local repository paths. That is easy to get wrong and slows down onboarding, especially when the user already knows the project they want from GitLab and wants a safer local path picker.

## What Changes
- Add GitLab project search to the managed-project create flow and populate the draft from the selected result.
- Add global settings for local repository root, default branch, and default remote.
- Use those settings to prefill new managed-project drafts, with `master` and `origin` as fallbacks.
- Replace manual typing for the local repository path with a native directory picker, while keeping the field editable.
- Keep all populated managed-project fields editable and repopulate the draft when the user selects a different GitLab project.

## Impact
- Affected specs:
  - `application-settings`
  - `managed-project-management`
- Affected code:
  - `src/pages/SettingsPage.tsx`
  - `src/pages/ManagedProjectsPage.tsx`
  - `src/lib/invoke.ts`
  - `src/lib/types.ts`
  - `src-tauri/src/db.rs`
  - `src-tauri/src/main.rs`
  - `src-tauri/src/models.rs`
  - `src-tauri/tauri.conf.json`
  - `src-tauri/capabilities/default.json`
  - `src-tauri/Cargo.toml`
  - `package.json`
