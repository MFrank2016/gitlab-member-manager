-- Workflow run history for execution monitoring, cancellation, and retry.
CREATE TABLE IF NOT EXISTS workflow_runs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_definition_id INTEGER NOT NULL,
  project_group_id      INTEGER NOT NULL,
  source_workflow_run_id INTEGER,
  trigger_kind          TEXT NOT NULL DEFAULT 'manual' CHECK (length(trim(trigger_kind)) > 0),
  status                TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'cancelling', 'completed', 'partial_failed', 'cancelled')
  ),
  run_parameters_json   TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(run_parameters_json) AND json_type(run_parameters_json) = 'object'
  ),
  max_concurrency       INTEGER NOT NULL CHECK (max_concurrency > 0),
  started_at            TEXT,
  finished_at           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (workflow_definition_id) REFERENCES workflow_definitions(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_group_id) REFERENCES project_groups(id) ON DELETE RESTRICT,
  FOREIGN KEY (source_workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS workflow_run_projects (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_run_id             INTEGER NOT NULL,
  managed_project_id          INTEGER,
  gitlab_project_id           INTEGER NOT NULL,
  project_name                TEXT NOT NULL CHECK (length(trim(project_name)) > 0),
  project_path_with_namespace TEXT NOT NULL CHECK (length(trim(project_path_with_namespace)) > 0),
  repo_path                   TEXT NOT NULL CHECK (length(trim(repo_path)) > 0),
  status                      TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'success', 'failed', 'cancelled', 'failed_precheck')
  ),
  summary_message             TEXT NOT NULL DEFAULT '',
  started_at                  TEXT,
  finished_at                 TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (managed_project_id) REFERENCES managed_projects(id) ON DELETE SET NULL,
  UNIQUE (workflow_run_id, gitlab_project_id)
);

CREATE TABLE IF NOT EXISTS workflow_run_steps (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_run_project_id   INTEGER NOT NULL,
  workflow_step_id          INTEGER,
  step_order                INTEGER NOT NULL CHECK (step_order >= 0),
  step_type                 TEXT NOT NULL CHECK (length(trim(step_type)) > 0),
  rendered_parameters_json  TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(rendered_parameters_json) AND json_type(rendered_parameters_json) = 'object'
  ),
  status                    TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'success', 'failed', 'skipped', 'cancelled')
  ),
  started_at                TEXT,
  finished_at               TEXT,
  stdout                    TEXT NOT NULL DEFAULT '',
  stderr                    TEXT NOT NULL DEFAULT '',
  exit_code                 INTEGER,
  summary_message           TEXT NOT NULL DEFAULT '',
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  FOREIGN KEY (workflow_run_project_id) REFERENCES workflow_run_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (workflow_step_id) REFERENCES workflow_steps(id) ON DELETE SET NULL,
  UNIQUE (workflow_run_project_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_workflow_runs_created_at
  ON workflow_runs(created_at);

CREATE INDEX IF NOT EXISTS idx_workflow_run_projects_run
  ON workflow_run_projects(workflow_run_id, id);

CREATE INDEX IF NOT EXISTS idx_workflow_run_steps_project
  ON workflow_run_steps(workflow_run_project_id, step_order);
