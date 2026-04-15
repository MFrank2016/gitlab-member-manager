ALTER TABLE pipeline_schedules
ADD COLUMN project_group_id INTEGER REFERENCES project_groups(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_pipeline_schedules_project_group
  ON pipeline_schedules(project_group_id);
