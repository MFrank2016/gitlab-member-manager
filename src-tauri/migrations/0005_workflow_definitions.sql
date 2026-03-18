-- Reusable workflow definitions for ordered, parameterized git steps.
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  name                     TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  description              TEXT NOT NULL DEFAULT '',
  enabled                  INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  variables_schema         TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(variables_schema) AND json_type(variables_schema) = 'object'
  ),
  max_concurrency_default  INTEGER NOT NULL DEFAULT 2 CHECK (max_concurrency_default > 0),
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_steps (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_definition_id  INTEGER NOT NULL,
  step_order              INTEGER NOT NULL CHECK (step_order >= 0),
  step_type               TEXT NOT NULL CHECK (length(trim(step_type)) > 0),
  parameters_json         TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(parameters_json) AND json_type(parameters_json) = 'object'
  ),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id) ON DELETE CASCADE,
  UNIQUE (workflow_definition_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_workflow_steps_definition_order
  ON workflow_steps(workflow_definition_id, step_order);
