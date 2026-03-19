## ADDED Requirements

### Requirement: Managed Project Defaults Are Persisted In Settings
The system SHALL allow users to persist managed-project defaults in application settings, including local repository root, default branch, and default remote.

#### Scenario: User saves managed-project defaults
- **WHEN** the user updates the settings page with a local repository root, a default branch, and a default remote
- **THEN** the values SHALL be stored and restored on the next launch

#### Scenario: Older config data is loaded
- **WHEN** existing settings data does not contain one or more of the new default fields
- **THEN** the application SHALL load successfully
- **AND THEN** the default branch SHALL behave as `master`
- **AND THEN** the default remote SHALL behave as `origin`
