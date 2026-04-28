-- Stage-aware pipeline definition support: stages, graph edges, and node layout metadata.

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_definition_id  INTEGER NOT NULL,
  stage_key               TEXT NOT NULL CHECK (length(trim(stage_key)) > 0),
  name                    TEXT NOT NULL CHECK (length(trim(name)) > 0),
  stage_order             INTEGER NOT NULL CHECK (stage_order >= 0),
  enabled                 INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL,
  FOREIGN KEY (pipeline_definition_id) REFERENCES pipeline_definitions(id) ON DELETE CASCADE,
  UNIQUE (pipeline_definition_id, stage_order),
  UNIQUE (pipeline_definition_id, stage_key)
);

ALTER TABLE pipeline_nodes ADD COLUMN stage_id INTEGER REFERENCES pipeline_stages(id) ON DELETE SET NULL;
ALTER TABLE pipeline_nodes ADD COLUMN node_key TEXT;
ALTER TABLE pipeline_nodes ADD COLUMN position_x REAL NOT NULL DEFAULT 0;
ALTER TABLE pipeline_nodes ADD COLUMN position_y REAL NOT NULL DEFAULT 0;
ALTER TABLE pipeline_nodes ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));

CREATE TABLE IF NOT EXISTS pipeline_edges (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_definition_id  INTEGER NOT NULL,
  source_node_id          INTEGER NOT NULL,
  target_node_id          INTEGER NOT NULL,
  created_at              TEXT NOT NULL,
  FOREIGN KEY (pipeline_definition_id) REFERENCES pipeline_definitions(id) ON DELETE CASCADE,
  FOREIGN KEY (source_node_id) REFERENCES pipeline_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_node_id) REFERENCES pipeline_nodes(id) ON DELETE CASCADE,
  CHECK (source_node_id != target_node_id),
  UNIQUE (pipeline_definition_id, source_node_id, target_node_id)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_definition_order
  ON pipeline_stages(pipeline_definition_id, stage_order);

CREATE INDEX IF NOT EXISTS idx_pipeline_nodes_stage
  ON pipeline_nodes(stage_id, node_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_nodes_definition_node_key
  ON pipeline_nodes(pipeline_definition_id, node_key)
  WHERE node_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pipeline_edges_definition
  ON pipeline_edges(pipeline_definition_id, id);

CREATE INDEX IF NOT EXISTS idx_pipeline_edges_source
  ON pipeline_edges(source_node_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_edges_target
  ON pipeline_edges(target_node_id);
