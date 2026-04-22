## MODIFIED Requirements

### Requirement: Structured Pipeline Schedules
The system SHALL allow each pipeline definition to own multiple schedules with structured time rules, timezone, variable overrides, and concurrency policy, without requiring a schedule-level project-group target.

#### Scenario: Create a daily schedule
- **WHEN** the user creates a schedule with a daily rule, timezone, variable overrides, and a concurrency policy
- **THEN** the system stores the schedule as structured data without requiring raw cron text or a project-group selection

#### Scenario: Create a weekly schedule
- **WHEN** the user configures a weekly rule with one or more weekdays and a specific time
- **THEN** the system validates and stores the weekdays, time, and timezone as structured schedule data

### Requirement: Desktop-Bound Scheduled Execution
The system SHALL evaluate pipeline schedules only while the desktop application is running, SHALL apply the configured concurrency policy when a schedule fires, and SHALL let the scheduled run resolve managed projects from `switch_project` nodes inside the pipeline.

#### Scenario: Skip a scheduled run while another run is active
- **WHEN** a schedule with `skip_if_running` fires while the same pipeline already has an active run
- **THEN** the system records that the schedule was skipped and does not start a new run

#### Scenario: Queue a scheduled run
- **WHEN** a schedule with `queue_after_running` fires while the same pipeline already has an active run
- **THEN** the system records a queued run request that starts after the active run completes

#### Scenario: Allow parallel scheduled runs
- **WHEN** a schedule with `allow_parallel` fires while the same pipeline already has an active run
- **THEN** the system creates a new run immediately even though another run is still active

#### Scenario: Start a scheduled run without a project-group target
- **WHEN** an enabled schedule fires for a pipeline that uses `switch_project` nodes
- **THEN** the system starts the scheduled run without requiring a project group and lets node execution select the managed projects in sequence

#### Scenario: Miss a trigger while the app is closed
- **WHEN** the scheduled trigger time passes while the desktop application is closed
- **THEN** the system does not backfill a missed run unless the user starts one manually later
