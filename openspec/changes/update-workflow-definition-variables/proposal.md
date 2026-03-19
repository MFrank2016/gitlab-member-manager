# Change: Improve workflow definition variable editing

## Why
The current workflow definition editor exposes `variablesSchema` as a raw JSON object even though the UI only needs variable names and defaults. It also labels the merge step too loosely, which makes users think they must provide both source and target branches even though execution only merges a source branch into the currently checked-out branch.

## What Changes
- Replace the workflow variables JSON editor with a key/value form for variable default values.
- Auto-insert missing variables into the form when workflow steps reference `${...}` placeholders.
- Validate workflow definitions before save so every referenced variable is declared.
- Clarify the built-in merge step wording to describe merging a source branch into the current branch.

## Impact
- Affected specs:
  - `git-workflow-execution`
- Affected code:
  - `src/pages/WorkflowsPage.tsx`
  - `src/lib/invoke.ts`
  - `src/lib/types.ts`
  - `src/__tests__/smoke.test.tsx`

