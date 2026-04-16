## ADDED Requirements

### Requirement: Efficient Desktop Scheduler Evaluation
The system SHALL evaluate desktop-bound pipeline schedules without scaling active-run checks as one independent database query per schedule.

#### Scenario: Evaluate multiple schedules in one tick
- **WHEN** the scheduler evaluates a tick that contains multiple enabled schedules
- **THEN** the system reuses shared active-run knowledge instead of requiring a separate active-run query for every schedule

### Requirement: Visible Schedule Outcome Feedback
The system SHALL expose enough schedule-state feedback for operators to understand whether a schedule started, queued, skipped, or is expected to fire next.

#### Scenario: Show queued or skipped schedule behavior
- **WHEN** a schedule fires under `skip_if_running` or `queue_after_running`
- **THEN** the system records and exposes whether the trigger was skipped or queued instead of leaving the operator to infer scheduler behavior manually

#### Scenario: Preview the next expected trigger
- **WHEN** the user inspects a pipeline definition or scheduler-focused view
- **THEN** the system shows the next expected trigger time for enabled schedules using the configured timezone
