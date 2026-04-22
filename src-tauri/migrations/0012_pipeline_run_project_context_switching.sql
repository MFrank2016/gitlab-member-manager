PRAGMA foreign_keys=OFF;

CREATE TABLE IF NOT EXISTS pipeline_runs_new (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_definition_id   INTEGER NOT NULL,
  project_group_id         INTEGER,
  legacy_workflow_run_id   INTEGER UNIQUE,
  source_pipeline_run_id   INTEGER,
  trigger_kind             TEXT NOT NULL DEFAULT 'manual' CHECK (length(trim(trigger_kind)) > 0),
  status                   TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'waiting', 'cancelling', 'completed', 'partial_failed', 'cancelled')
  ),
  run_parameters_json      TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(run_parameters_json) AND json_type(run_parameters_json) = 'object'
  ),
  max_concurrency          INTEGER NOT NULL CHECK (max_concurrency > 0),
  started_at               TEXT,
  finished_at              TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  FOREIGN KEY (pipeline_definition_id) REFERENCES pipeline_definitions(id) ON DELETE RESTRICT,
  FOREIGN KEY (project_group_id) REFERENCES project_groups(id) ON DELETE RESTRICT,
  FOREIGN KEY (legacy_workflow_run_id) REFERENCES workflow_runs(id) ON DELETE SET NULL,
  FOREIGN KEY (source_pipeline_run_id) REFERENCES pipeline_runs(id) ON DELETE SET NULL
);

INSERT INTO pipeline_runs_new (
  id,
  pipeline_definition_id,
  project_group_id,
  legacy_workflow_run_id,
  source_pipeline_run_id,
  trigger_kind,
  status,
  run_parameters_json,
  max_concurrency,
  started_at,
  finished_at,
  created_at,
  updated_at
)
SELECT
  id,
  pipeline_definition_id,
  project_group_id,
  legacy_workflow_run_id,
  source_pipeline_run_id,
  trigger_kind,
  status,
  run_parameters_json,
  max_concurrency,
  started_at,
  finished_at,
  created_at,
  updated_at
FROM pipeline_runs;

DROP TABLE pipeline_runs;
ALTER TABLE pipeline_runs_new RENAME TO pipeline_runs;

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at
  ON pipeline_runs(created_at);

CREATE TABLE IF NOT EXISTS pipeline_run_projects_new (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_id             INTEGER NOT NULL,
  managed_project_id          INTEGER,
  gitlab_project_id           INTEGER NOT NULL,
  project_name                TEXT NOT NULL CHECK (length(trim(project_name)) > 0),
  project_path_with_namespace TEXT NOT NULL CHECK (length(trim(project_path_with_namespace)) > 0),
  repo_path                   TEXT NOT NULL CHECK (length(trim(repo_path)) > 0),
  status                      TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'waiting', 'success', 'failed', 'cancelled', 'failed_precheck')
  ),
  summary_message             TEXT NOT NULL DEFAULT '',
  started_at                  TEXT,
  finished_at                 TEXT,
  created_at                  TEXT NOT NULL,
  updated_at                  TEXT NOT NULL,
  FOREIGN KEY (pipeline_run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (managed_project_id) REFERENCES managed_projects(id) ON DELETE SET NULL
);

INSERT INTO pipeline_run_projects_new (
  id,
  pipeline_run_id,
  managed_project_id,
  gitlab_project_id,
  project_name,
  project_path_with_namespace,
  repo_path,
  status,
  summary_message,
  started_at,
  finished_at,
  created_at,
  updated_at
)
SELECT
  id,
  pipeline_run_id,
  managed_project_id,
  gitlab_project_id,
  project_name,
  project_path_with_namespace,
  repo_path,
  status,
  summary_message,
  started_at,
  finished_at,
  created_at,
  updated_at
FROM pipeline_run_projects;

DROP TABLE pipeline_run_projects;
ALTER TABLE pipeline_run_projects_new RENAME TO pipeline_run_projects;

CREATE INDEX IF NOT EXISTS idx_pipeline_run_projects_run
  ON pipeline_run_projects(pipeline_run_id, id);

PRAGMA foreign_keys=ON;
