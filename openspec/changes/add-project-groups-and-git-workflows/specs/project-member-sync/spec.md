## ADDED Requirements

### Requirement: Member Source Reuse
The system SHALL support resolving batch member-sync inputs from existing local member groups and manually selected local members.

#### Scenario: Use a local member group as the source
- **WHEN** the user selects a local member group as the member source for a project group sync
- **THEN** the system resolves the members in that local member group before issuing project membership operations

#### Scenario: Use explicitly selected local members as the source
- **WHEN** the user manually selects local members for a project group sync
- **THEN** the system uses only the selected local members as the member source

### Requirement: Project-Group Batch Member Sync
The system SHALL support applying one resolved member source to every managed project in a selected project group.

#### Scenario: Sync members into all projects in a project group
- **WHEN** the user launches a member sync for a project group with an access level and optional expiry
- **THEN** the system attempts to add the resolved members to every managed project in the group

#### Scenario: One project fails during member sync
- **WHEN** member sync fails for one managed project in the selected project group
- **THEN** the system continues processing the remaining managed projects and records per-project results

### Requirement: Member Sync Result Reporting
The system SHALL present project-level success and failure results for project-group member sync operations.

#### Scenario: Review member sync results
- **WHEN** a batch member sync completes
- **THEN** the system shows which projects succeeded, which projects failed, and the error messages associated with failed projects

