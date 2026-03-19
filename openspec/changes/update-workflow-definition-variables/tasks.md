## 1. Workflow Variable Editor
- [x] 1.1 Replace the raw workflow variables JSON text area with a variable/default-value form.
- [x] 1.2 Auto-add missing variable rows when step parameters reference `${...}` placeholders.

## 2. Validation and Copy
- [x] 2.1 Validate on create/update that all referenced variables are declared.
- [x] 2.2 Update merge-step wording to describe merging a source branch into the current branch.

## 3. Verification
- [x] 3.1 Add or update tests for auto-added variables, save validation, and merge-step labels.
- [x] 3.2 Run `openspec validate update-workflow-definition-variables --strict`, `pnpm test`, and `pnpm build`.
