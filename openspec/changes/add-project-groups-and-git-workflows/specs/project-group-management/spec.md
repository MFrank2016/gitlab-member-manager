## ADDED Requirements

### Requirement: Managed Project Registry
The system SHALL allow users to register a managed project that binds a GitLab project to a local repository path and project metadata.

#### Scenario: Register a project for project-group operations
- **WHEN** a user selects a GitLab project and provides a local repository path
- **THEN** the system stores the GitLab project identifier, path-with-namespace, local repository path, default remote, default branch, and enabled status

#### Scenario: Reject invalid managed project registration
- **WHEN** the user provides an empty repository path or a duplicate GitLab project binding
- **THEN** the system rejects the registration and returns a validation error

### Requirement: Local Project Groups
The system SHALL provide CRUD operations for local project groups and support assigning multiple managed projects into a group.

#### Scenario: Create and populate a project group
- **WHEN** the user creates a project group and bulk-selects managed projects to add
- **THEN** the system stores the group and its project membership locally

#### Scenario: Remove a managed project from a group
- **WHEN** the user removes a managed project from a project group
- **THEN** the system deletes only the group membership and preserves the managed project record

### Requirement: Project Group Visibility
The system SHALL show the managed projects that belong to a selected project group together with enough metadata to launch batch operations.

#### Scenario: Inspect a project group
- **WHEN** the user opens a project group
- **THEN** the system displays the group members with their GitLab project identifiers, path-with-namespace, repository paths, and enabled status

