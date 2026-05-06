## ADDED Requirements

### Requirement: Predictable Pipeline Graph Canvas Interactions
The system SHALL provide predictable stage and node editing interactions in the visual pipeline graph editor, including left-click selection, scoped right-click menus, and validated node creation flows.

#### Scenario: Select a stage for editing
- **WHEN** the user left-clicks a stage on the pipeline graph canvas
- **THEN** the system SHALL mark that stage as selected and open the stage editing state in the inspector

#### Scenario: Select a node for editing
- **WHEN** the user left-clicks a node on the pipeline graph canvas
- **THEN** the system SHALL mark that node as selected, open the node editing state in the inspector, and keep the node's owning stage as the active stage context

#### Scenario: Open the stage context menu
- **WHEN** the user right-clicks a stage on the pipeline graph canvas
- **THEN** the system SHALL open a stage-scoped context menu that exposes actions to create a node in that stage or delete that stage

#### Scenario: Open the node context menu
- **WHEN** the user right-clicks a node on the pipeline graph canvas
- **THEN** the system SHALL open a node-scoped context menu that exposes an action to delete that node

#### Scenario: Create a node with strict validation
- **WHEN** the user starts node creation from a stage context menu and submits the create-node dialog
- **THEN** the system SHALL require a node type and that node type's required fields before creating the node
- **AND THEN** the system SHALL keep the draft unchanged when the dialog validation fails

### Requirement: Structured Stage Graph Layout
The system SHALL arrange nodes inside each stage with deterministic stage-local grid slots, preserve whitespace for connections, auto-size each stage from its occupied slots, and constrain drag behavior to stage-local node reflow and horizontal stage sorting.

#### Scenario: Layout nodes in a stage-local grid
- **WHEN** a stage contains one or more nodes in the pipeline graph editor
- **THEN** the system SHALL place those nodes into a stage-local grid layout with consistent spacing that preserves readable connection paths
- **AND THEN** the system SHALL size the stage container from the grid occupancy instead of keeping a fixed container size

#### Scenario: Reflow nodes after a stage-local drop
- **WHEN** the user drags a node to another slot inside the same stage and drops it onto an occupied or newly targeted slot
- **THEN** the system SHALL recompute the current stage's node slot order without overlap
- **AND THEN** the system SHALL keep the change scoped to that stage only

#### Scenario: Reorder stages without freeform placement
- **WHEN** the user drags a stage on the pipeline graph canvas
- **THEN** the system SHALL interpret that drag as horizontal stage sorting only
- **AND THEN** the system SHALL persist the resulting stage order without enabling freeform stage placement
