-- Managed projects: bind GitLab project metadata to local repository location.
CREATE TABLE IF NOT EXISTS managed_projects (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  gitlab_project_id   INTEGER NOT NULL UNIQUE,
  name                TEXT NOT NULL CHECK (length(trim(name)) > 0),
  path_with_namespace TEXT NOT NULL CHECK (length(trim(path_with_namespace)) > 0),
  repo_path           TEXT NOT NULL CHECK (length(trim(repo_path)) > 0),
  default_branch      TEXT NOT NULL DEFAULT 'main' CHECK (length(trim(default_branch)) > 0),
  default_remote      TEXT NOT NULL DEFAULT 'origin' CHECK (length(trim(default_remote)) > 0),
  enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Local project groups for batch operations.
CREATE TABLE IF NOT EXISTS project_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- Many-to-many mapping between project groups and managed projects.
CREATE TABLE IF NOT EXISTS project_group_items (
  project_group_id    INTEGER NOT NULL,
  managed_project_id  INTEGER NOT NULL,
  created_at          TEXT NOT NULL,
  PRIMARY KEY (project_group_id, managed_project_id),
  FOREIGN KEY (project_group_id) REFERENCES project_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (managed_project_id) REFERENCES managed_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_group_items_project
  ON project_group_items(managed_project_id);
