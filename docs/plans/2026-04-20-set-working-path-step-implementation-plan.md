# Set Working Path Step Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a built-in `set_working_path` step/node that updates per-project local execution context so later local Git steps inherit the new working directory.

**Architecture:** Keep the current local Git execution model, but insert one lightweight per-project runtime context carrying `working_dir`. Add the new built-in type to editor payloads and route both Git prechecks and Git command execution through that shared context so relative path changes are sequential and deterministic.

**Tech Stack:** Rust, Tauri, React, TypeScript, OpenSpec, Vitest

---

### Task 1: Lock the runtime contract with failing tests

**Files:**
- Modify: `src-tauri/src/pipeline_runtime.rs`
- Modify: `src-tauri/src/workflow_runtime_legacy.rs`
- Modify: `src-tauri/src/git_executor.rs`

**Step 1: Write the failing pipeline runtime test**

Add a focused test proving:

- `set_working_path` updates the per-project working directory
- a later `checkout_branch` or `git_pull` step uses the updated directory

**Step 2: Run the failing pipeline test**

Run:

```bash
cargo test -j 1 --manifest-path src-tauri/Cargo.toml working_path_pipeline_runtime
```

Expected: FAIL because no runtime working-directory context exists yet.

**Step 3: Write the failing relative-path test**

Add a second focused test proving:

- one `set_working_path` can move into a directory
- a later relative `set_working_path` resolves from that updated directory instead of the original `repoPath`

**Step 4: Run the failing relative-path test**

Run:

```bash
cargo test -j 1 --manifest-path src-tauri/Cargo.toml working_path_relative_resolution
```

Expected: FAIL because relative path chaining is not implemented yet.

**Step 5: Commit the red tests**

```bash
git add src-tauri/src/pipeline_runtime.rs src-tauri/src/workflow_runtime_legacy.rs src-tauri/src/git_executor.rs
git commit -m "test: add working path runtime regressions"
```

### Task 2: Add runtime working-directory context

**Files:**
- Modify: `src-tauri/src/pipeline_runtime.rs`
- Modify: `src-tauri/src/workflow_runtime_legacy.rs`
- Modify: `src-tauri/src/git_executor.rs`

**Step 1: Introduce a per-project execution context**

Add a small runtime struct carrying at least:

- `working_dir`
- the managed project reference or any values still needed from it

Initialize `working_dir` from `ManagedProject.repoPath`.

**Step 2: Implement `set_working_path` resolution**

Implement path resolution rules:

- render `path`
- if absolute, use as-is
- if relative, resolve from current `working_dir`
- reject empty, missing, or non-directory paths

**Step 3: Route Git prechecks through the context**

Change local Git prechecks so they validate against current `working_dir`, not always `repoPath`.

**Step 4: Route Git command execution through the context**

Change actual Git commands to execute in current `working_dir`.

**Step 5: Run the focused runtime tests**

Run:

```bash
cargo test -j 1 --manifest-path src-tauri/Cargo.toml working_path_pipeline_runtime
cargo test -j 1 --manifest-path src-tauri/Cargo.toml working_path_relative_resolution
```

Expected: PASS

**Step 6: Commit the runtime implementation**

```bash
git add src-tauri/src/pipeline_runtime.rs src-tauri/src/workflow_runtime_legacy.rs src-tauri/src/git_executor.rs
git commit -m "feat: add working path runtime context"
```

### Task 3: Add Chinese-first invalid-path failures

**Files:**
- Modify: `src-tauri/src/git_executor.rs`
- Modify: `src-tauri/src/pipeline_runtime.rs`
- Modify: `src-tauri/src/workflow_runtime_legacy.rs`

**Step 1: Write the failing invalid-path regression**

Add a focused test proving:

- empty path, missing path, or non-directory path fails immediately
- later local execution for that project does not continue
- failure messaging stays Chinese-first

**Step 2: Run the failing invalid-path regression**

Run:

```bash
cargo test -j 1 --manifest-path src-tauri/Cargo.toml working_path_invalid_path
```

Expected: FAIL because path validation and failure classification are incomplete.

**Step 3: Implement Chinese-first path validation failures**

Add explicit path validation and failure-envelope mapping for:

- empty path
- path does not exist
- target is not a directory
- later Git steps against a non-worktree directory

**Step 4: Re-run the invalid-path regression**

Run:

```bash
cargo test -j 1 --manifest-path src-tauri/Cargo.toml working_path_invalid_path
```

Expected: PASS

**Step 5: Commit the failure-handling slice**

```bash
git add src-tauri/src/git_executor.rs src-tauri/src/pipeline_runtime.rs src-tauri/src/workflow_runtime_legacy.rs
git commit -m "feat: add working path validation failures"
```

### Task 4: Expose the step in editor models and payloads

**Files:**
- Modify: `src/components/pipeline-editor/draft-model.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/pages/WorkflowRunsPagePipeline.tsx`
- Test: `src/pages/__tests__/workflow-definition-variables.test.tsx`

**Step 1: Write the failing frontend payload test**

Add a focused test that saves a definition containing `set_working_path` with a variable-based path.

**Step 2: Run the failing frontend test**

Run:

```bash
pnpm exec vitest run src/pages/__tests__/workflow-definition-variables.test.tsx
```

Expected: FAIL because the built-in node list and payload path do not know this step yet.

**Step 3: Add the new built-in node definition**

Wire:

- built-in label `设置执行路径`
- one field `path`
- variable-friendly placeholder such as `${repo_root}/subdir`

**Step 4: Re-run the frontend test**

Run:

```bash
pnpm exec vitest run src/pages/__tests__/workflow-definition-variables.test.tsx
```

Expected: PASS

**Step 5: Commit the editor slice**

```bash
git add src/components/pipeline-editor/draft-model.ts src/lib/types.ts src/pages/WorkflowRunsPagePipeline.tsx src/pages/__tests__/workflow-definition-variables.test.tsx
git commit -m "feat: expose set working path node"
```

### Task 5: Verify and close the change

**Files:**
- Modify: `openspec/changes/add-working-path-context-step/tasks.md`

**Step 1: Run focused Rust verification**

```bash
cargo test -j 1 --manifest-path src-tauri/Cargo.toml working_path
```

Expected: PASS

**Step 2: Run focused frontend verification**

```bash
pnpm test:release-identity
pnpm exec vitest run src/pages/__tests__/workflow-definition-variables.test.tsx
```

Expected: PASS

**Step 3: Validate the OpenSpec change**

```bash
openspec validate add-working-path-context-step --strict
```

Expected: valid

**Step 4: Mark the checklist complete**

Update `openspec/changes/add-working-path-context-step/tasks.md` so every completed task is checked.

**Step 5: Commit the verification closure**

```bash
git add openspec/changes/add-working-path-context-step/tasks.md
git commit -m "docs: close working path context change"
```
