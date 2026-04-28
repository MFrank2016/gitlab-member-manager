## ADDED Requirements

### Requirement: Stage-Aware DAG Release Pipeline Definitions
The system SHALL support reusable release pipeline definitions composed of ordered stages, stage-owned built-in nodes, dependency edges, pipeline-level variables, and versioned metadata.

#### Scenario: Create a stage-aware release pipeline definition
- **WHEN** the user creates a release pipeline definition with one or more stages, assigns nodes to stages, and draws valid dependency edges
- **THEN** the system stores the stage order, node ownership, edge graph, node configuration, variable definitions, and versioned metadata for reuse

#### Scenario: Reject a cyclic release graph
- **WHEN** the user saves a release pipeline definition whose node edges form a cycle
- **THEN** the system SHALL reject the save and explain that cyclic release dependencies are not allowed

#### Scenario: Reject a dependency from a later stage to an earlier stage
- **WHEN** the user connects a node in a later stage to a node in an earlier stage
- **THEN** the system SHALL reject the save because stages only flow forward

### Requirement: Stage-Serial And In-Stage-Parallel Runtime
The system SHALL execute stages serially within a pipeline run and SHALL execute nodes inside the active stage as soon as their dependencies are satisfied.

#### Scenario: Advance to the next stage only after the active stage succeeds
- **WHEN** a stage contains multiple nodes and all nodes in that stage finish successfully
- **THEN** the system starts the next stage and never starts it earlier

#### Scenario: Run independent nodes in parallel inside one stage
- **WHEN** two nodes in the same stage have no unsatisfied dependencies
- **THEN** the system may run them in parallel within the same pipeline run

### Requirement: Stage Failure Blocks Downstream Stages
The system SHALL stop launching new nodes in the active stage after a node failure, SHALL allow already-running peer nodes to finish, and SHALL block all downstream stages from starting.

#### Scenario: One node fails while peer nodes are already running
- **WHEN** one node in the active stage fails after other peer nodes in that stage have already started
- **THEN** the system does not schedule any additional nodes in that stage, allows the running peer nodes to finish, marks the stage failed or partially failed, and does not start downstream stages

#### Scenario: Explain why a later stage never started
- **WHEN** an upstream stage fails and a later stage stays pending
- **THEN** the run record SHALL preserve enough stage status and summary information for the UI to explain which earlier stage blocked progress

### Requirement: Stage And Node Derived Retries
The system SHALL support derived retries for the full run, a selected stage, or a selected failed node while preserving lineage through `source_pipeline_run_id`.

#### Scenario: Retry from a failed stage
- **WHEN** the user retries a failed run from a selected failed stage
- **THEN** the system creates a new pipeline run, marks earlier successful stages as reused, and restarts execution from the selected stage

#### Scenario: Retry from a failed node
- **WHEN** the user retries a failed run from a selected failed node
- **THEN** the system creates a new pipeline run, marks unrelated successful work as reused, and reruns the selected node together with its downstream dependency chain

### Requirement: Visual DAG Authoring
The system SHALL provide a visual DAG editor for release pipelines using stage grouping, custom action nodes, and dependency edges.

#### Scenario: Edit a pipeline graph visually
- **WHEN** the user adds stages, drags nodes, and connects edges in the pipeline editor
- **THEN** the system persists the graph structure and node positions so the definition can be reloaded without losing the visual layout
