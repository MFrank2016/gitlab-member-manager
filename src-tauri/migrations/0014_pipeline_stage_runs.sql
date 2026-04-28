-- Stage runtime tracking for stage-aware DAG pipeline execution.

CREATE TABLE IF NOT EXISTS pipeline_run_stages (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_run_id       INTEGER NOT NULL,
  pipeline_stage_id     INTEGER,
  stage_order           INTEGER NOT NULL CHECK (stage_order >= 0),
  stage_key             TEXT NOT NULL CHECK (length(trim(stage_key)) > 0),
  stage_name_snapshot   TEXT NOT NULL CHECK (length(trim(stage_name_snapshot)) > 0),
  status                TEXT NOT NULL CHECK (
    status IN ('pending', 'running', 'waiting', 'success', 'partial_failed', 'failed', 'cancelled', 'reused')
  ),
  summary_message       TEXT NOT NULL DEFAULT '',
  started_at            TEXT,
  finished_at           TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (pipeline_run_id) REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (pipeline_stage_id) REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  UNIQUE (pipeline_run_id, stage_order)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_run_stages_run
  ON pipeline_run_stages(pipeline_run_id, stage_order);
