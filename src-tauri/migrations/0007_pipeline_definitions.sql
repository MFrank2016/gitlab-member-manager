-- Pipeline definitions for orchestrated release flows with variables, nodes, and schedules.
CREATE TABLE IF NOT EXISTS pipeline_definitions (
  id                             INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_workflow_definition_id  INTEGER UNIQUE,
  name                           TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  description                    TEXT NOT NULL DEFAULT '',
  enabled                        INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  max_concurrency_default        INTEGER NOT NULL DEFAULT 2 CHECK (max_concurrency_default > 0),
  created_at                     TEXT NOT NULL,
  updated_at                     TEXT NOT NULL,
  FOREIGN KEY (legacy_workflow_definition_id) REFERENCES workflow_definitions(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pipeline_variables (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_definition_id  INTEGER NOT NULL,
  variable_order          INTEGER NOT NULL CHECK (variable_order >= 0),
  key                     TEXT NOT NULL CHECK (length(trim(key)) > 0),
  label                   TEXT NOT NULL DEFAULT '',
  default_value           TEXT,
  value_type              TEXT NOT NULL CHECK (length(trim(value_type)) > 0),
  required                INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  options_json            TEXT NOT NULL DEFAULT '[]' CHECK (
    json_valid(options_json) AND json_type(options_json) = 'array'
  ),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  FOREIGN KEY (pipeline_definition_id) REFERENCES pipeline_definitions(id) ON DELETE CASCADE,
  UNIQUE (pipeline_definition_id, variable_order),
  UNIQUE (pipeline_definition_id, key)
);

CREATE TABLE IF NOT EXISTS pipeline_nodes (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_definition_id  INTEGER NOT NULL,
  node_order              INTEGER NOT NULL CHECK (node_order >= 0),
  node_type               TEXT NOT NULL CHECK (length(trim(node_type)) > 0),
  parameters_json         TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(parameters_json) AND json_type(parameters_json) = 'object'
  ),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  FOREIGN KEY (pipeline_definition_id) REFERENCES pipeline_definitions(id) ON DELETE CASCADE,
  UNIQUE (pipeline_definition_id, node_order)
);

CREATE TABLE IF NOT EXISTS pipeline_schedules (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_definition_id  INTEGER NOT NULL,
  schedule_order          INTEGER NOT NULL CHECK (schedule_order >= 0),
  cron_expr               TEXT NOT NULL CHECK (length(trim(cron_expr)) > 0),
  timezone                TEXT NOT NULL CHECK (length(trim(timezone)) > 0),
  branch                  TEXT,
  enabled                 INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  policy                  TEXT NOT NULL CHECK (length(trim(policy)) > 0),
  variables_json          TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(variables_json) AND json_type(variables_json) = 'object'
  ),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  FOREIGN KEY (pipeline_definition_id) REFERENCES pipeline_definitions(id) ON DELETE CASCADE,
  UNIQUE (pipeline_definition_id, schedule_order)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_variables_definition_order
  ON pipeline_variables(pipeline_definition_id, variable_order);

CREATE INDEX IF NOT EXISTS idx_pipeline_nodes_definition_order
  ON pipeline_nodes(pipeline_definition_id, node_order);

CREATE INDEX IF NOT EXISTS idx_pipeline_schedules_definition_order
  ON pipeline_schedules(pipeline_definition_id, schedule_order);
