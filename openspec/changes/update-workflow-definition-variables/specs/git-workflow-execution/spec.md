## MODIFIED Requirements

### Requirement: Linear Workflow Definitions
The system SHALL support reusable workflow definitions composed of ordered git workflow steps with parameterized inputs and declared workflow variables.

#### Scenario: Create a linear workflow definition
- **WHEN** the user creates a workflow definition and adds ordered git steps
- **THEN** the system stores the ordered steps, step parameters, workflow-level metadata, and declared variable default values for reuse

#### Scenario: Step placeholders introduce new variables
- **WHEN** the user adds or edits a step parameter that references a `${variable_name}` placeholder
- **THEN** the editor SHALL ensure that variable appears in the workflow variable form
- **AND THEN** newly inserted variables SHALL default to an empty string value

#### Scenario: Save rejects undeclared variables
- **WHEN** any workflow step references a `${variable_name}` placeholder that is not declared in the workflow variable form
- **THEN** the system SHALL reject saving the workflow definition
- **AND THEN** the validation message SHALL identify the missing variable names

#### Scenario: Use run-time branch variables
- **WHEN** the user runs a workflow definition that references branch placeholders such as source and target branches
- **THEN** the system resolves those placeholders from run-time input values before executing each step

#### Scenario: Merge step copy explains target branch semantics
- **WHEN** the user configures the built-in merge step in the workflow editor
- **THEN** the editor SHALL describe the step as merging a source branch into the current branch
- **AND THEN** the source branch field SHALL remain the only required merge parameter

