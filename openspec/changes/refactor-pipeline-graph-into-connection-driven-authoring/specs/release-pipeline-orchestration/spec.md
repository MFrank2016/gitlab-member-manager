## ADDED Requirements

### Requirement: Connection-Driven Pipeline Graph Authoring
The system SHALL let users author pipeline graphs by creating successor nodes from output anchors instead of relying on stage-scoped add-node flows.

#### Scenario: Create the first node from an empty stage
- **WHEN** the user activates the empty-stage start anchor output point
- **THEN** the system SHALL open the successor-creation flow for that stage without mutating the persisted draft yet
- **AND THEN** the created node SHALL be written only after required fields pass validation

#### Scenario: Create a direct successor from a node
- **WHEN** the user activates a node output anchor and submits a valid successor definition
- **THEN** the system SHALL create the new node in the source node's stage by default
- **AND THEN** the system SHALL create the dependency edge from the source node to the new node
- **AND THEN** the system SHALL select the created node and focus the node inspector

#### Scenario: Cancel successor creation
- **WHEN** the user exits the successor-creation flow without confirming
- **THEN** the system SHALL discard any preview edge or pending node UI state
- **AND THEN** the persisted draft SHALL remain unchanged

### Requirement: Layered Successor Layout In Stage Containers
The system SHALL arrange nodes inside each stage with connection-driven layered layout, uniform node size, centered successor groups, and stage-internal dual-axis centering.

#### Scenario: Create the first direct successor
- **WHEN** node A creates its first direct successor B
- **THEN** the system SHALL place B to the right of A
- **AND THEN** A and B SHALL remain horizontally aligned

#### Scenario: Create a second direct successor
- **WHEN** node A already has direct successor B and the user creates direct successor C from A
- **THEN** the system SHALL keep B and C as direct successors of A instead of chaining A to C through B
- **AND THEN** the system SHALL stack B above C in the successor column to the right of A
- **AND THEN** the system SHALL align A to the vertical center of the B/C successor group

#### Scenario: Keep stage content visually centered
- **WHEN** stage content changes because of successor creation, deletion, or drag reflow
- **THEN** the system SHALL recompute the stage content bounds
- **AND THEN** the system SHALL keep the stage content horizontally and vertically centered inside the stage container

### Requirement: Cross-Stage Structural Dragging
The system SHALL interpret node dragging as structural intent, allow cross-stage reassignment, and rebuild the affected graph into a legal stage-aware DAG.

#### Scenario: Reassign a node to another stage by drag
- **WHEN** the user drops a node into another stage's valid target region
- **THEN** the system SHALL update that node's `stageKey`
- **AND THEN** the system SHALL reflow both the source stage and the target stage
- **AND THEN** the system SHALL persist the resulting structure through the `PipelineDraft` path

#### Scenario: Reorder stages from dependencies
- **WHEN** cross-stage dependencies imply a different legal stage order after node creation or drag reassignment
- **THEN** the system SHALL compute a stable topological order for stages
- **AND THEN** the system SHALL preserve previous relative order for unrelated stages whenever dependency rules allow it

#### Scenario: Reject an illegal graph result
- **WHEN** a drag or structural edit would still create an illegal DAG after reassignment and stable stage reorder are attempted
- **THEN** the system SHALL roll back that edit instead of leaving the graph in an invalid intermediate state
- **AND THEN** the system SHALL show a simplified-Chinese failure reason that explains why the change was rejected

