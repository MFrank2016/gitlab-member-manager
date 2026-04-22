## MODIFIED Requirements

### Requirement: Built-In Release Pipeline Execution
The system SHALL execute built-in pipeline nodes serially within a pipeline run, persist node-level state transitions, rendered configuration, and output context, and derive the active managed project from ordered pipeline nodes instead of requiring a run-level project group target.

#### Scenario: Start a manual pipeline run
- **WHEN** the user starts a pipeline run from the desktop application
- **THEN** the system creates a pipeline run record without requiring a selected project group and executes nodes in order

#### Scenario: Persist waiting-state details
- **WHEN** a pipeline node enters a waiting state for an external condition
- **THEN** the system persists the waiting target, latest observed status, next poll time, and elapsed wait duration for UI monitoring

#### Scenario: Block project-dependent execution before a project is selected
- **WHEN** a local Git node or GitLab-aware node executes before any active managed project has been selected
- **THEN** the system marks the node as a Chinese precheck failure and instructs the operator to add or move a `switch_project` node earlier in the pipeline

## ADDED Requirements

### Requirement: Managed Project Switching Nodes
The system SHALL provide a built-in `switch_project` node that selects an enabled managed project by `managedProjectId`, updates the active project context, and lets later nodes execute against the most recently selected managed project.

#### Scenario: Configure a switch-project node in the editor
- **WHEN** the user edits a `switch_project` node
- **THEN** the editor stores the selected `managedProjectId` and shows the managed project's current display name

#### Scenario: Switch projects multiple times in one run
- **WHEN** a pipeline contains multiple `switch_project` nodes such as `A -> B -> A`
- **THEN** each later node executes against the most recently selected managed project and the run monitor preserves the encountered project-segment order

#### Scenario: Use the active managed project as the default GitLab target
- **WHEN** a GitLab-aware node executes after `switch_project` and its `project` field is blank
- **THEN** the system uses the active managed project's `path_with_namespace` as the GitLab project target
