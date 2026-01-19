-- Local member library
CREATE TABLE IF NOT EXISTS local_members (
  user_id     INTEGER PRIMARY KEY,
  username    TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  updated_at  TEXT NOT NULL
);

-- Local virtual groups
CREATE TABLE IF NOT EXISTS local_groups (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

-- Group members
CREATE TABLE IF NOT EXISTS local_group_members (
  group_id    INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (group_id, user_id),
  FOREIGN KEY (group_id) REFERENCES local_groups(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES local_members(user_id) ON DELETE CASCADE
);
