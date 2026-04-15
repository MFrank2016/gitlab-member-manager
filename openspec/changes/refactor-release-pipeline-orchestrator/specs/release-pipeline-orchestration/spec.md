## ADDED Requirements

### Requirement: Unified Release Pipeline Definitions
The system SHALL support reusable release pipeline definitions composed of ordered built-in nodes, pipeline-level variables, and versioned metadata.

#### Scenario: Create a release pipeline definition
- **WHEN** the user creates a release pipeline definition with ordered built-in nodes
- **THEN** the system stores the definition, node order, node configuration, variable definitions, and versioned metadata for reuse

#### Scenario: Resolve pipeline variables at run time
- **WHEN** a pipeline definition references placeholders such as `${release_branch}` or `${remote}`
- **THEN** the system resolves those placeholders from run input values or pipeline defaults before each node executes

### Requirement: Legacy Workflow Migration
The system SHALL migrate existing `workflow_*` definitions and history into the `pipeline_*` model without requiring manual recreation.

#### Scenario: Upgrade an existing installation
- **WHEN** the application starts on a database that already contains `workflow_*` definitions, steps, and run history
- **THEN** the system creates equivalent `pipeline_*` records and keeps the legacy data available during the transition window

#### Scenario: Repeat the migration safely
- **WHEN** the application re-runs the migration on a database that was already upgraded
- **THEN** the system does not duplicate migrated pipeline definitions or run history

### Requirement: Built-In Release Pipeline Execution
The system SHALL execute built-in pipeline nodes serially within a pipeline run and persist node-level state transitions, rendered configuration, and output context.

#### Scenario: Start a manual pipeline run
- **WHEN** the user starts a pipeline run from the desktop application
- **THEN** the system creates a pipeline run record, executes nodes in order, and persists per-node status, rendered inputs, and output context

#### Scenario: Persist waiting-state details
- **WHEN** a pipeline node enters a waiting state for an external condition
- **THEN** the system persists the waiting target, latest observed status, next poll time, and elapsed wait duration for UI monitoring

### Requirement: GitLab Pipeline Coordination Nodes
The system SHALL provide built-in nodes to check, wait for, and trigger GitLab pipelines.

#### Scenario: Wait for the pipeline created by a prior node
- **WHEN** a `wait_pipeline` node follows a node that produced a specific commit or pipeline context
- **THEN** the system waits on the matching GitLab pipeline for that commit instead of blindly following the branch's latest pipeline

#### Scenario: Check a branch-head pipeline
- **WHEN** the user configures a health-check style `check_pipeline` or `wait_pipeline` node for a branch head
- **THEN** the system may query the latest pipeline for that branch and persist the observed result in the pipeline run record

#### Scenario: Trigger a downstream pipeline
- **WHEN** a `trigger_pipeline` node executes successfully
- **THEN** the system records the triggered pipeline identifier and related evidence in the node result

### Requirement: Chinese Failure Reporting And Derived Reruns
The system SHALL store structured Chinese-facing failure summaries together with technical evidence and SHALL support derived reruns from a failed or selected restart point.

#### Scenario: Display a failed node
- **WHEN** a pipeline node fails
- **THEN** the system stores a stable error code, Chinese title, Chinese detail, Chinese suggestion, and raw technical evidence for the UI

#### Scenario: Derive a rerun from a failure
- **WHEN** the user retries a failed run from the failed node or another allowed restart point
- **THEN** the system creates a new pipeline run linked by `source_run_id` and records the selected restart semantics
