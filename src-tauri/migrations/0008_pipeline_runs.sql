-- Pipeline run history for future execution monitoring and retry lineage.
CREATE TABLE IF NOT EXISTS pipeline_runs (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_definition_id   INTEGER NOT NULL,
  project_group_id         INTEGER NOT NULL,
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

CREATE TABLE IF NOT EXISTS pipeline_run_projects (
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
  FOREIGN KEY (managed_project_id) REFERENCES managed_projects(id) ON DELETE SET NULL,
  UNIQUE (pipeline_run_id, gitlab_project_id)
);

CREATE TABLE IF NOT EXISTS pipeline_run_nodes (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_project_id   INTEGER NOT NULL,
  pipeline_node_id          INTEGER,
  node_order                INTEGER NOT NULL CHECK (node_order >= 0),
  node_type                 TEXT NOT NULL CHECK (length(trim(node_type)) > 0),
  rendered_parameters_json  TEXT NOT NULL DEFAULT '{}' CHECK (
    json_valid(rendered_parameters_json) AND json_type(rendered_parameters_json) = 'object'
  ),
  status                    TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'waiting', 'success', 'failed', 'skipped', 'cancelled')
  ),
  started_at                TEXT,
  finished_at               TEXT,
  stdout                    TEXT NOT NULL DEFAULT '',
  stderr                    TEXT NOT NULL DEFAULT '',
  exit_code                 INTEGER,
  summary_message           TEXT NOT NULL DEFAULT '',
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL,
  FOREIGN KEY (pipeline_run_project_id) REFERENCES pipeline_run_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (pipeline_node_id) REFERENCES pipeline_nodes(id) ON DELETE SET NULL,
  UNIQUE (pipeline_run_project_id, node_order)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at
  ON pipeline_runs(created_at);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_projects_run
  ON pipeline_run_projects(pipeline_run_id, id);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_nodes_project
  ON pipeline_run_nodes(pipeline_run_project_id, node_order);
