## ADDED Requirements

### Requirement: Scalable Pipeline Run Monitoring
The system SHALL provide paginated and filterable pipeline run history plus summary-first run detail loading so monitoring remains responsive as execution history grows.

#### Scenario: Load recent pipeline runs
- **WHEN** the user opens the pipeline run monitor
- **THEN** the system returns a paginated list of recent pipeline runs instead of requiring the full historical run set

#### Scenario: Load heavy run detail lazily
- **WHEN** the user views a pipeline run and has not expanded node-level diagnostic output
- **THEN** the system returns the run summary, project summary, and node summary without requiring all heavy log and evidence payloads up front

### Requirement: Active Run Auto-Refresh
The system SHALL automatically refresh active pipeline runs while they are still non-terminal and stop refreshing once they reach a terminal state.

#### Scenario: Monitor an active run
- **WHEN** the selected pipeline run is in a pending, running, waiting, or cancelling state
- **THEN** the monitor keeps refreshing the run state without requiring manual refresh clicks

#### Scenario: Stop refreshing a completed run
- **WHEN** the selected pipeline run transitions to a terminal state
- **THEN** the monitor stops automatic refresh activity for that run unless the user explicitly refreshes again

### Requirement: Structured Operator-Facing Runtime Errors
The system SHALL classify runtime failures into stable categories so the frontend can present clearer operator guidance than a raw string-only failure.

#### Scenario: Render a recoverable configuration issue
- **WHEN** a pipeline action fails because required GitLab configuration is missing
- **THEN** the system returns a stable error category that allows the UI to guide the operator toward settings recovery

#### Scenario: Render a remote execution failure
- **WHEN** a pipeline node fails because of a Git or GitLab execution problem
- **THEN** the system returns a stable runtime category together with the Chinese-facing failure envelope and technical evidence

### Requirement: Visual Pipeline Run Inspection
The system SHALL provide at least one operator-focused visual inspection mode beyond plain tabular history for complex pipeline runs.

#### Scenario: Inspect the execution graph
- **WHEN** the user switches to a visual inspection mode for a pipeline run
- **THEN** the system shows the node order, current node states, and failed or waiting nodes in a form that is easier to understand than text-only tables

#### Scenario: Inspect cross-project execution progress
- **WHEN** the user needs to compare multiple managed projects inside a single run
- **THEN** the system provides a project-oriented execution view that makes it easy to see which project is blocked at which node
