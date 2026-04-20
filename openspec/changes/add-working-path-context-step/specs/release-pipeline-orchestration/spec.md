## ADDED Requirements

### Requirement: Working Directory Context Nodes
The system SHALL support a built-in `set_working_path` pipeline node that updates the current local working directory for later local pipeline nodes in the same per-project execution chain.

#### Scenario: Switch the working directory before a later local node
- **WHEN** a pipeline run executes `set_working_path` and a later local Git-oriented node such as checkout, pull, merge, or push
- **THEN** the later local node executes against the working directory set by the most recent successful `set_working_path` node instead of always using the original managed project repository path

#### Scenario: Resolve relative path from the latest context
- **WHEN** a `set_working_path` node uses a relative path
- **THEN** the system resolves that relative path from the latest successful working-directory context for that project execution chain

#### Scenario: Reject an invalid target path
- **WHEN** a `set_working_path` node resolves to an empty path, a missing path, or a target that is not a directory
- **THEN** the system fails the node immediately, stops later local node execution for that project, and stores a Chinese-first failure reason

#### Scenario: Reject a later local Git node in a non-repository directory
- **WHEN** a successful `set_working_path` node switches into a directory that is not a Git worktree and a later local Git-oriented node executes
- **THEN** the system fails the later node against that updated directory and stores a Chinese-first failure reason that identifies the current working directory
