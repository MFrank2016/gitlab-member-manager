# Set Working Path Step Design

Date: 2026-04-20
Status: confirmed for implementation planning

## Context

The current local execution model for workflow and pipeline Git steps assumes a fixed working directory:

- every local Git step runs under `ManagedProject.repoPath`
- there is no runtime context object that can be updated by one step and inherited by later steps

This blocks a requested sequential execution pattern:

- set a path first
- let later steps such as branch checkout and pull continue from that updated path
- allow both absolute paths and relative paths
- keep path values variable-driven

The requested capability is not a file explorer action. It is a runtime context step that updates the working directory for later local steps.

## Goals

- add a built-in step that updates execution working directory for later local steps
- support path values rendered from variables
- support both absolute paths and relative paths
- resolve relative paths from the current runtime context, not always from the original managed project root
- fail immediately with Chinese-first errors when the path is invalid
- let later local Git steps inherit the updated working directory in order

## Non-Goals

- opening Windows File Explorer
- auto-creating missing directories
- changing the app identifier, local data directory, or managed project storage model
- limiting path changes to the original `repoPath`
- introducing arbitrary shell scripting

## Decision Summary

### 1. Add one explicit built-in step: `set_working_path`

The new step should be modeled as a first-class built-in step instead of hiding path changes inside variable mutation or per-step optional parameters.

Recommended shape:

```json
{
  "nodeType": "set_working_path",
  "parameters": {
    "path": "${repo_root}/subdir"
  }
}
```

The Chinese UI label should be `设置执行路径`.

This is clearer than overloading later Git steps with their own path field because the sequence itself shows when the context changes.

### 2. Introduce one per-project runtime execution context

Local execution should carry a lightweight runtime context for each managed project run.

Recommended shape:

```text
ExecutionContext
- working_dir: PathBuf
- managed_project: ManagedProject
```

Initial state:

- `working_dir = managed_project.repoPath`

After `set_working_path` succeeds:

- update `working_dir`
- keep that updated value for all later local steps in the same project execution chain

This is a general runtime-context model, not a Git-only one, even though the first consumers are Git steps.

### 3. Support both absolute and relative paths

Path resolution rules:

- absolute path: use as-is after variable rendering
- relative path: resolve against current `ExecutionContext.working_dir`

This allows chains such as:

```text
repoPath
-> set_working_path(${repo_root}/subdir)
-> checkout_branch(main)
-> set_working_path(../another-repo)
-> git_pull(origin, release)
```

The second path change depends on the first context update, which matches the requested behavior.

### 4. Allow arbitrary absolute paths

The step should not be restricted to the original `ManagedProject.repoPath`.

This means the runtime must accept path changes outside the managed project root as long as the target path is valid.

The trade-off is that operators can move into directories that are not Git repositories. That is acceptable because the user explicitly chose broader path freedom, and later step prechecks will reject invalid Git contexts.

### 5. Fail fast with Chinese-first validation errors

The step must stop the local execution chain immediately when the target path is invalid.

Expected error classes:

- target path is empty
- target path does not exist
- target path is not a directory
- current working directory is invalid so a relative path cannot be resolved
- later Git steps fail because the current path is not a Git worktree

Recommended Chinese messages:

- `目标路径为空，无法设置执行路径`
- `目标路径不存在：D:/...`
- `目标路径不是目录：D:/...`
- `当前执行路径无效，无法解析相对路径`
- `当前执行路径不是 Git 仓库：D:/...`

### 6. Update Git prechecks and execution to use the same runtime path

The new context only works if all local Git validation and execution paths consume the same `working_dir`.

That means these paths should stop reading directly from `ManagedProject.repoPath` during step execution:

- repository precheck
- per-step precheck
- actual Git command execution

Otherwise the system could validate one directory and execute in another, which would create misleading success and failure states.

## UI And Editor Changes

The pipeline and workflow editor should treat `set_working_path` as a new built-in node/step with one focused field:

- field key: `path`
- label: `目标路径`

Recommended placeholders:

- `${repo_root}/subdir`
- `../another-repo`
- `D:/repos/project-a`

The editor should keep using existing variable rendering rules. No new variable type is needed for this slice.

## Runtime Feedback

On success, the run monitor summary should make the context switch visible.

Recommended summary messages:

- `执行路径已切换到 D:/repos/project-a`
- `执行路径已切换到 D:/repos/project-a/scripts`

This is important because the operator needs to understand why later Git steps are executing in a different directory than the original managed project root.

## Testing Strategy

Add focused regression coverage for:

1. `set_working_path` updates runtime context and later Git steps use the updated directory
2. relative paths resolve from the latest context, not always from `ManagedProject.repoPath`
3. invalid paths fail immediately with Chinese-first errors
4. switching into a non-Git directory causes later Git-step prechecks to fail against the updated path
5. editor support for the new built-in step preserves the expected payload shape

## Risks And Mitigations

### Risk: context updates become implicit and hard to reason about

Mitigation:

- make `set_working_path` an explicit built-in step
- show the path switch clearly in run summaries

### Risk: operators move into unrelated directories and later Git steps fail

Mitigation:

- allow the broader path model as requested
- keep strict directory and Git-worktree validation with immediate failure

### Risk: implementation accidentally mixes original repo path and updated runtime path

Mitigation:

- route both prechecks and execution through one `ExecutionContext.working_dir`
- add regression tests that prove a later step really runs in the updated directory

## Recommended Next Step

Because this is a new built-in execution capability and changes runtime behavior, the next step should be:

1. create an OpenSpec change for the new step and runtime-context behavior
2. write an implementation plan from this design
3. only then begin coding
