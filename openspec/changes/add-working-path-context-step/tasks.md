## 1. Runtime Context
- [x] 1.1 Add a per-project local execution context that carries the current working directory, initialized from `ManagedProject.repoPath`.
- [x] 1.2 Add the built-in `set_working_path` step/node and update local Git prechecks plus command execution to use the shared runtime working directory.
- [x] 1.3 Fail fast with Chinese-first path validation and non-Git-directory errors when path switching or later Git steps are invalid.

## 2. Editor And Payloads
- [x] 2.1 Expose `set_working_path` as a built-in step/node in the definition editor with a focused `path` field and variable-friendly placeholders.
- [x] 2.2 Preserve payload validation so relative and absolute path inputs serialize through the existing definition save flow.

## 3. Verification
- [x] 3.1 Add focused regression coverage for sequential working-directory inheritance, relative-path resolution, and invalid-path failure handling.
- [x] 3.2 Validate the change with `openspec validate add-working-path-context-step --strict`.
