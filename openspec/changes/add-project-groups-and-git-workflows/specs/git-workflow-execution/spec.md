## ADDED Requirements

### Requirement: Linear Workflow Definitions
The system SHALL support reusable workflow definitions composed of ordered git workflow steps with parameterized inputs.

#### Scenario: Create a linear workflow definition
- **WHEN** the user creates a workflow definition and adds ordered git steps
- **THEN** the system stores the ordered steps, step parameters, and workflow-level metadata for reuse

#### Scenario: Use run-time branch variables
- **WHEN** the user runs a workflow definition that references branch placeholders such as source and target branches
- **THEN** the system resolves those placeholders from run-time input values before executing each step

### Requirement: Multi-Project Workflow Execution
The system SHALL execute workflow definitions across multiple managed projects in a selected project group with serial per-project execution and bounded cross-project concurrency.

#### Scenario: Run a workflow across a project group
- **WHEN** the user starts a workflow run for a project group
- **THEN** the system queues all eligible managed projects, executes steps serially within each project, and respects the configured project concurrency limit

#### Scenario: One project workflow fails
- **WHEN** a step fails for one managed project during a workflow run
- **THEN** the system marks only that project as failed and continues processing the remaining projects

### Requirement: Workflow Visibility and History
The system SHALL persist workflow run history with per-project and per-step status, timestamps, and command output.

#### Scenario: Inspect a previous workflow run
- **WHEN** the user opens a completed or failed workflow run
- **THEN** the system displays the run summary, project-level states, step-level states, timestamps, and stored stdout/stderr output

### Requirement: Workflow Cancellation and Retry
The system SHALL support cooperative cancellation of an active workflow run and rerunning failed projects as a new workflow run.

#### Scenario: Cancel a running workflow
- **WHEN** the user cancels a workflow run
- **THEN** the system stops scheduling new projects, lets active projects stop at a safe execution boundary, and records the cancellation state

#### Scenario: Retry failed projects
- **WHEN** the user chooses to retry failed projects from a previous workflow run
- **THEN** the system creates a new workflow run that includes only the selected failed projects and references the source run

