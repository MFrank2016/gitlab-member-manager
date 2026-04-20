## ADDED Requirements

### Requirement: Working Directory Context Steps
The system SHALL support a built-in `set_working_path` workflow step that updates the current local working directory for later local workflow steps in the same per-project execution chain.

#### Scenario: Switch the working directory before a later workflow step
- **WHEN** a workflow run executes `set_working_path` and a later local Git-oriented workflow step such as checkout, pull, merge, or push
- **THEN** the later workflow step executes against the working directory set by the most recent successful `set_working_path` step instead of always using the original managed project repository path

#### Scenario: Resolve a relative workflow path
- **WHEN** a `set_working_path` workflow step uses a relative path
- **THEN** the system resolves that relative path from the latest successful working-directory context for that project workflow chain

#### Scenario: Fail fast on an invalid workflow path
- **WHEN** a `set_working_path` workflow step resolves to an empty path, a missing path, or a target that is not a directory
- **THEN** the system fails that step immediately, stops later workflow execution for that project, and stores a Chinese-first failure reason
