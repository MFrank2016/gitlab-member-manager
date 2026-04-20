## Context

Local Git execution is currently anchored to one fixed repository path. The requested behavior introduces a sequential runtime context: one step updates the working directory, and later local steps inherit that updated value.

This is broader than a single Git-step parameter because the value must persist across later steps in order.

## Goals

- add an explicit built-in context-changing step
- allow absolute and relative path inputs
- resolve relative paths from the latest working-directory context
- keep immediate Chinese-first failures for invalid path transitions

## Non-Goals

- opening Windows File Explorer
- auto-creating missing directories
- changing the app identifier or migrating local data paths
- introducing arbitrary shell steps

## Decisions

- Decision: add one explicit built-in step/node `set_working_path`
  - Why: it makes the context transition visible in the execution sequence
  - Alternative rejected: add a `path` parameter to every later Git step

- Decision: keep one per-project runtime `working_dir` context
  - Why: both validation and execution need to read the same directory to avoid split-brain behavior

- Decision: allow arbitrary absolute paths and relative paths
  - Why: the requested behavior explicitly allows path changes outside the original `repoPath`
  - Trade-off: later Git steps may fail if the new directory is not a repository, which is acceptable because the operator chose the path

- Decision: fail immediately instead of creating directories
  - Why: silent directory creation would make later Git failures harder to diagnose

## Risks / Trade-offs

- Risk: local execution becomes harder to reason about if context changes are implicit
  - Mitigation: keep `set_working_path` explicit and show path-change summaries in run output

- Risk: implementation accidentally validates against one directory and executes in another
  - Mitigation: route both prechecks and command execution through one shared runtime `working_dir`

## Migration Plan

- Add the new built-in type alongside existing built-in steps/nodes.
- Do not rewrite stored legacy definitions automatically.
- Allow operators to adopt the new step in newly edited definitions.
