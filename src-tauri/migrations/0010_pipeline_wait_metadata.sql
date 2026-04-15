ALTER TABLE pipeline_run_nodes ADD COLUMN wait_target TEXT;

ALTER TABLE pipeline_run_nodes ADD COLUMN last_remote_status TEXT;

ALTER TABLE pipeline_run_nodes ADD COLUMN remote_pipeline_id INTEGER;

ALTER TABLE pipeline_run_nodes ADD COLUMN wait_context_json TEXT CHECK (
  wait_context_json IS NULL OR (json_valid(wait_context_json) AND json_type(wait_context_json) = 'object')
);
