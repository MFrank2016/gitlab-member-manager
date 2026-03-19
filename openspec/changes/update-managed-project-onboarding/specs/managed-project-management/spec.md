## ADDED Requirements

### Requirement: GitLab Project Assisted Managed Project Creation
The system SHALL let users search GitLab projects from the managed-project creation flow and populate the draft from the selected result.

#### Scenario: User selects a project from search results
- **WHEN** the user searches GitLab projects and selects a result
- **THEN** the draft SHALL populate the GitLab project ID, project name, and `path_with_namespace`
- **AND THEN** the local repository path SHALL be suggested from the configured local repository root plus the selected project name
- **AND THEN** the populated fields SHALL remain editable

#### Scenario: User reselects a different project
- **WHEN** the user has manually edited one or more project-derived fields and selects a different GitLab project
- **THEN** the draft SHALL be repopulated from the newly selected project
- **AND THEN** the repo path suggestion SHALL be recomputed from the new project name

#### Scenario: Computed path already exists
- **WHEN** the computed local repository path already exists on disk
- **THEN** the application SHALL keep that exact path as the suggestion
- **AND THEN** it SHALL NOT append a suffix or otherwise regenerate a different path

### Requirement: Managed Project Path Uses Native Directory Selection
The system SHALL let users choose the local repository path from the managed-project form using a native directory picker.

#### Scenario: User opens the directory picker
- **WHEN** the user activates the local repository path control
- **THEN** the application SHALL open a native directory selection dialog
- **AND THEN** the chosen path SHALL populate the form
- **AND THEN** the field SHALL remain manually editable after selection

### Requirement: New Managed Projects Use Global Defaults
The system SHALL initialize new managed-project drafts with the configured default branch and default remote.

#### Scenario: Create form opens with stored defaults
- **WHEN** the user opens the managed-project create form
- **THEN** the default branch SHALL initialize from settings, or `master` if no value is stored
- **AND THEN** the default remote SHALL initialize from settings, or `origin` if no value is stored
- **AND THEN** those values SHALL remain editable
