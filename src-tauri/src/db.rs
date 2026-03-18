use crate::models::{LocalGroup, LocalMember, LocalMemberUpsert, ManagedProject, ProjectGroup};
use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use sqlx::{
  migrate::Migrator,
  sqlite::{SqliteConnectOptions, SqlitePoolOptions},
  SqlitePool,
};
use std::str::FromStr;
use tauri::Manager;

pub async fn init_db(app: &tauri::AppHandle) -> Result<SqlitePool> {
  let dir = app
    .path()
    .app_data_dir()
    .context("failed to resolve app_data_dir")?;
  std::fs::create_dir_all(&dir).context("failed to create app data dir")?;

  let db_path = dir.join("gitlab_member_manager.sqlite3");
  // sqlx sqlite URL 在 Windows 需要使用正斜杠，否则会因反斜杠被当成转义而连接失败
  let db_url = format!(
    "sqlite://{}",
    db_path
      .to_string_lossy()
      .replace('\\', "/")
  );

  tracing::info!(db_path = %db_path.display(), "[db] initializing database");

  let options = SqliteConnectOptions::from_str(&db_url)
    .context("invalid sqlite url")?
    .create_if_missing(true);

  let pool = SqlitePoolOptions::new()
    .max_connections(5)
    .connect_with(options)
    .await
    .with_context(|| format!("failed to connect sqlite: {}", db_url))?;

  tracing::info!("[db] running migrations");
  static MIGRATOR: Migrator = sqlx::migrate!();
  MIGRATOR.run(&pool).await?;

  tracing::info!("[db] database initialized successfully");
  Ok(pool)
}

fn u64_to_i64_checked(value: u64, field_name: &str) -> Result<i64> {
  i64::try_from(value).map_err(|_| anyhow!("{field_name} out of range for SQLite INTEGER: {value}"))
}

fn i64_to_u64_checked(value: i64, field_name: &str) -> Result<u64> {
  u64::try_from(value).map_err(|_| anyhow!("{field_name} out of range for u64: {value}"))
}

pub async fn create_managed_project(
  pool: &SqlitePool,
  gitlab_project_id: u64,
  name: String,
  path_with_namespace: String,
  repo_path: String,
  default_branch: Option<String>,
  default_remote: Option<String>,
  enabled: bool,
) -> Result<ManagedProject> {
  let now = Utc::now().to_rfc3339();
  let default_branch = default_branch.unwrap_or_else(|| "main".to_string());
  let default_remote = default_remote.unwrap_or_else(|| "origin".to_string());
  let enabled_value = if enabled { 1_i64 } else { 0_i64 };
  let gitlab_project_id_i64 = u64_to_i64_checked(gitlab_project_id, "gitlab_project_id")?;

  let res = sqlx::query(
    r#"INSERT INTO managed_projects (
         gitlab_project_id, name, path_with_namespace, repo_path,
         default_branch, default_remote, enabled, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)"#,
  )
  .bind(gitlab_project_id_i64)
  .bind(&name)
  .bind(&path_with_namespace)
  .bind(&repo_path)
  .bind(&default_branch)
  .bind(&default_remote)
  .bind(enabled_value)
  .bind(&now)
  .bind(&now)
  .execute(pool)
  .await?;

  Ok(ManagedProject {
    id: res.last_insert_rowid(),
    gitlab_project_id,
    name,
    path_with_namespace,
    repo_path,
    default_branch,
    default_remote,
    enabled,
    created_at: now.clone(),
    updated_at: now,
  })
}

pub async fn list_managed_projects(pool: &SqlitePool) -> Result<Vec<ManagedProject>> {
  let rows = sqlx::query_as::<_, (i64, i64, String, String, String, String, String, i64, String, String)>(
    r#"SELECT
         id, gitlab_project_id, name, path_with_namespace, repo_path,
         default_branch, default_remote, enabled, created_at, updated_at
       FROM managed_projects
       ORDER BY id DESC"#,
  )
  .fetch_all(pool)
  .await?;

  let mut items = Vec::with_capacity(rows.len());
  for r in rows {
    items.push(ManagedProject {
      id: r.0,
      gitlab_project_id: i64_to_u64_checked(r.1, "managed_projects.gitlab_project_id")?,
      name: r.2,
      path_with_namespace: r.3,
      repo_path: r.4,
      default_branch: r.5,
      default_remote: r.6,
      enabled: r.7 != 0,
      created_at: r.8,
      updated_at: r.9,
    });
  }

  Ok(items)
}

#[allow(clippy::too_many_arguments)]
pub async fn update_managed_project(
  pool: &SqlitePool,
  id: i64,
  gitlab_project_id: u64,
  name: String,
  path_with_namespace: String,
  repo_path: String,
  default_branch: String,
  default_remote: String,
  enabled: bool,
) -> Result<()> {
  let now = Utc::now().to_rfc3339();
  let enabled_value = if enabled { 1_i64 } else { 0_i64 };
  let gitlab_project_id_i64 = u64_to_i64_checked(gitlab_project_id, "gitlab_project_id")?;

  let res = sqlx::query(
    r#"UPDATE managed_projects
       SET gitlab_project_id = ?1,
           name = ?2,
           path_with_namespace = ?3,
           repo_path = ?4,
           default_branch = ?5,
           default_remote = ?6,
           enabled = ?7,
           updated_at = ?8
       WHERE id = ?9"#,
  )
  .bind(gitlab_project_id_i64)
  .bind(&name)
  .bind(&path_with_namespace)
  .bind(&repo_path)
  .bind(&default_branch)
  .bind(&default_remote)
  .bind(enabled_value)
  .bind(&now)
  .bind(id)
  .execute(pool)
  .await?;

  if res.rows_affected() == 0 {
    return Err(anyhow!("managed project not found: {id}"));
  }

  Ok(())
}

pub async fn delete_managed_project(pool: &SqlitePool, id: i64) -> Result<()> {
  let res = sqlx::query(r#"DELETE FROM managed_projects WHERE id = ?1"#)
    .bind(id)
    .execute(pool)
    .await?;

  if res.rows_affected() == 0 {
    return Err(anyhow!("managed project not found: {id}"));
  }

  Ok(())
}

pub async fn create_project_group(pool: &SqlitePool, name: String) -> Result<ProjectGroup> {
  let now = Utc::now().to_rfc3339();
  let res = sqlx::query(
    r#"INSERT INTO project_groups (name, created_at, updated_at)
       VALUES (?1, ?2, ?3)"#,
  )
  .bind(&name)
  .bind(&now)
  .bind(&now)
  .execute(pool)
  .await?;

  Ok(ProjectGroup {
    id: res.last_insert_rowid(),
    name,
    created_at: now.clone(),
    updated_at: now,
    projects_count: 0,
  })
}

pub async fn list_project_groups(pool: &SqlitePool) -> Result<Vec<ProjectGroup>> {
  let rows = sqlx::query_as::<_, (i64, String, String, String, i64)>(
    r#"SELECT
         g.id, g.name, g.created_at, g.updated_at, COUNT(i.managed_project_id) as projects_count
       FROM project_groups g
       LEFT JOIN project_group_items i ON i.project_group_id = g.id
       GROUP BY g.id
       ORDER BY g.id DESC"#,
  )
  .fetch_all(pool)
  .await?;

  Ok(
    rows
      .into_iter()
      .map(|r| ProjectGroup {
        id: r.0,
        name: r.1,
        created_at: r.2,
        updated_at: r.3,
        projects_count: r.4,
      })
      .collect(),
  )
}

pub async fn upsert_local_members(pool: &SqlitePool, members: Vec<LocalMemberUpsert>) -> Result<()> {
  let count = members.len();
  tracing::info!(count = count, "[db] upsert_local_members starting");
  
  let mut tx = pool.begin().await?;
  let now = Utc::now().to_rfc3339();

  for m in members {
    sqlx::query(
      r#"INSERT INTO local_members (user_id, username, name, avatar_url, updated_at, project_id, project_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(user_id) DO UPDATE SET
           username=excluded.username,
           name=excluded.name,
           avatar_url=excluded.avatar_url,
           updated_at=excluded.updated_at,
           project_id=excluded.project_id,
           project_name=excluded.project_name
      "#,
    )
    .bind(m.user_id as i64)
    .bind(m.username)
    .bind(m.name)
    .bind(m.avatar_url)
    .bind(&now)
    .bind(m.project_id.map(|x| x as i64))
    .bind(m.project_name.as_deref())
    .execute(&mut *tx)
    .await?;
  }

  tx.commit().await?;
  tracing::info!(count = count, "[db] upsert_local_members completed");
  Ok(())
}

/// 分页列出本地成员，返回 (列表, 总条数)
pub async fn list_local_members(
  pool: &SqlitePool,
  query: Option<String>,
  page: u32,
  per_page: u32,
) -> Result<(Vec<LocalMember>, u64)> {
  let per_page = per_page.clamp(1, 100);
  let offset = (page.saturating_sub(1)) * per_page;

  let (total, rows) = if let Some(q) = query {
    let like = format!("%{}%", q);
    let total: (i64,) = sqlx::query_as(
      r#"SELECT COUNT(*) FROM local_members WHERE username LIKE ?1 OR name LIKE ?1"#,
    )
    .bind(&like)
    .fetch_one(pool)
    .await?;

    let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, String, Option<i64>, Option<String>)>(
      r#"SELECT user_id, username, name, avatar_url, updated_at, project_id, project_name
         FROM local_members
         WHERE username LIKE ?1 OR name LIKE ?1
         ORDER BY updated_at DESC
         LIMIT ?2 OFFSET ?3
      "#,
    )
    .bind(&like)
    .bind(per_page as i64)
    .bind(offset as i64)
    .fetch_all(pool)
    .await?;

    (total.0 as u64, rows)
  } else {
    let total: (i64,) = sqlx::query_as(r#"SELECT COUNT(*) FROM local_members"#)
      .fetch_one(pool)
      .await?;

    let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, String, Option<i64>, Option<String>)>(
      r#"SELECT user_id, username, name, avatar_url, updated_at, project_id, project_name
         FROM local_members
         ORDER BY updated_at DESC
         LIMIT ?1 OFFSET ?2
      "#,
    )
    .bind(per_page as i64)
    .bind(offset as i64)
    .fetch_all(pool)
    .await?;

    (total.0 as u64, rows)
  };

  tracing::debug!(count = rows.len(), total = total, "[db] list_local_members result");

  let items: Vec<LocalMember> = rows
    .into_iter()
    .map(|r| LocalMember {
      user_id: r.0 as u64,
      username: r.1,
      name: r.2,
      avatar_url: r.3,
      updated_at: r.4,
      project_id: r.5.map(|x| x as u64),
      project_name: r.6,
    })
    .collect();

  Ok((items, total))
}

pub async fn delete_local_members(pool: &SqlitePool, user_ids: Vec<u64>) -> Result<()> {
  if user_ids.is_empty() {
    return Ok(());
  }
  // local_group_members 的 user_id 有 ON DELETE CASCADE，删除 local_members 时会自动清理
  let mut tx = pool.begin().await?;
  for uid in &user_ids {
    sqlx::query(r#"DELETE FROM local_members WHERE user_id = ?1"#)
      .bind(*uid as i64)
      .execute(&mut *tx)
      .await?;
  }
  tx.commit().await?;
  tracing::info!(count = user_ids.len(), "[db] delete_local_members");
  Ok(())
}

pub async fn create_local_group(pool: &SqlitePool, name: String) -> Result<LocalGroup> {
  tracing::info!(name = %name, "[db] create_local_group");
  
  let now = Utc::now().to_rfc3339();
  let res = sqlx::query(
    r#"INSERT INTO local_groups (name, created_at) VALUES (?1, ?2)"#,
  )
  .bind(&name)
  .bind(&now)
  .execute(pool)
  .await?;

  let id = res.last_insert_rowid();
  tracing::info!(group_id = id, name = %name, "[db] create_local_group success");
  Ok(LocalGroup {
    id,
    name,
    created_at: now,
    members_count: 0,
  })
}

pub async fn update_local_group(pool: &SqlitePool, id: i64, name: String) -> Result<()> {
  sqlx::query(r#"UPDATE local_groups SET name = ?1 WHERE id = ?2"#)
    .bind(&name)
    .bind(id)
    .execute(pool)
    .await?;
  tracing::info!(group_id = id, name = %name, "[db] update_local_group");
  Ok(())
}

pub async fn delete_local_group(pool: &SqlitePool, id: i64) -> Result<()> {
  // local_group_members 有 ON DELETE CASCADE，会自动清理
  sqlx::query(r#"DELETE FROM local_groups WHERE id = ?1"#)
    .bind(id)
    .execute(pool)
    .await?;
  tracing::info!(group_id = id, "[db] delete_local_group");
  Ok(())
}

pub async fn list_local_groups(pool: &SqlitePool) -> Result<Vec<LocalGroup>> {
  tracing::debug!("[db] list_local_groups");
  
  let rows = sqlx::query_as::<_, (i64, String, String, i64)>(
    r#"
    SELECT g.id, g.name, g.created_at, COUNT(gm.user_id) as members_count
    FROM local_groups g
    LEFT JOIN local_group_members gm ON gm.group_id = g.id
    GROUP BY g.id
    ORDER BY g.id DESC
    "#,
  )
  .fetch_all(pool)
  .await?;

  tracing::debug!(count = rows.len(), "[db] list_local_groups result");
  
  Ok(
    rows
      .into_iter()
      .map(|r| LocalGroup {
        id: r.0,
        name: r.1,
        created_at: r.2,
        members_count: r.3,
      })
      .collect(),
  )
}

pub async fn add_members_to_group(pool: &SqlitePool, group_id: i64, user_ids: Vec<u64>) -> Result<()> {
  let count = user_ids.len();
  tracing::info!(group_id = group_id, count = count, "[db] add_members_to_group");
  
  let mut tx = pool.begin().await?;
  let now = Utc::now().to_rfc3339();

  for uid in user_ids {
    sqlx::query(
      r#"INSERT OR IGNORE INTO local_group_members (group_id, user_id, created_at)
         VALUES (?1, ?2, ?3)"#,
    )
    .bind(group_id)
    .bind(uid as i64)
    .bind(&now)
    .execute(&mut *tx)
    .await?;
  }

  tx.commit().await?;
  tracing::info!(group_id = group_id, count = count, "[db] add_members_to_group completed");
  Ok(())
}

pub async fn remove_members_from_group(pool: &SqlitePool, group_id: i64, user_ids: Vec<u64>) -> Result<()> {
  let count = user_ids.len();
  tracing::info!(group_id = group_id, count = count, "[db] remove_members_from_group");
  
  let mut tx = pool.begin().await?;

  for uid in user_ids {
    sqlx::query(
      r#"DELETE FROM local_group_members WHERE group_id=?1 AND user_id=?2"#,
    )
    .bind(group_id)
    .bind(uid as i64)
    .execute(&mut *tx)
    .await?;
  }

  tx.commit().await?;
  tracing::info!(group_id = group_id, count = count, "[db] remove_members_from_group completed");
  Ok(())
}

pub async fn list_group_members(pool: &SqlitePool, group_id: i64) -> Result<Vec<LocalMember>> {
  tracing::debug!(group_id = group_id, "[db] list_group_members");
  
  let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, String, Option<i64>, Option<String>)>(
    r#"SELECT m.user_id, m.username, m.name, m.avatar_url, m.updated_at, m.project_id, m.project_name
       FROM local_members m
       INNER JOIN local_group_members gm ON gm.user_id = m.user_id
       WHERE gm.group_id = ?1
       ORDER BY m.username ASC"#,
  )
  .bind(group_id)
  .fetch_all(pool)
  .await?;

  tracing::debug!(group_id = group_id, count = rows.len(), "[db] list_group_members result");
  
  Ok(
    rows
      .into_iter()
      .map(|r| LocalMember {
        user_id: r.0 as u64,
        username: r.1,
        name: r.2,
        avatar_url: r.3,
        updated_at: r.4,
        project_id: r.5.map(|x| x as u64),
        project_name: r.6,
      })
      .collect(),
  )
}

/// 从 config 表读取 GitLab 配置，key = "gitlab"，value 为 JSON：{ "baseUrl": "...", "token": "..." }
pub async fn get_gitlab_config(pool: &SqlitePool) -> Result<Option<(String, String)>> {
  let row = sqlx::query_as::<_, (String,)>(
    r#"SELECT value FROM config WHERE key = 'gitlab'"#,
  )
  .fetch_optional(pool)
  .await?;

  let Some((json,)) = row else {
    return Ok(None);
  };

  #[derive(serde::Deserialize)]
  struct Cfg {
    base_url: String,
    token: String,
  }
  let cfg: Cfg = serde_json::from_str(&json).context("parse gitlab config json")?;
  Ok(Some((cfg.base_url, cfg.token)))
}

/// 保存 GitLab 配置到 config 表
pub async fn set_gitlab_config(pool: &SqlitePool, base_url: &str, token: &str) -> Result<()> {
  let json = serde_json::json!({ "base_url": base_url, "token": token }).to_string();
  sqlx::query(
    r#"INSERT INTO config (key, value) VALUES ('gitlab', ?1)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value"#,
  )
  .bind(&json)
  .execute(pool)
  .await?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  use sqlx::sqlite::SqlitePoolOptions;

  static TEST_MIGRATOR: Migrator = sqlx::migrate!();

  async fn setup_test_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
      .max_connections(1)
      .connect("sqlite::memory:")
      .await
      .expect("connect in-memory sqlite");
    TEST_MIGRATOR.run(&pool).await.expect("run migrations");
    pool
  }

  #[tokio::test]
  async fn managed_projects_create_and_list() {
    let pool = setup_test_pool().await;

    let empty_projects = list_managed_projects(&pool)
      .await
      .expect("list empty managed projects");
    assert!(empty_projects.is_empty());

    let empty_groups = list_project_groups(&pool)
      .await
      .expect("list empty project groups");
    assert!(empty_groups.is_empty());

    let created = create_managed_project(
      &pool,
      10001,
      "project-alpha".to_string(),
      "group/project-alpha".to_string(),
      "D:/repos/project-alpha".to_string(),
      None,
      None,
      true,
    )
    .await
    .expect("create managed project");

    assert_eq!(created.gitlab_project_id, 10001);
    assert_eq!(created.default_branch, "main");
    assert_eq!(created.default_remote, "origin");
    assert!(created.enabled);

    let items = list_managed_projects(&pool)
      .await
      .expect("list managed projects");

    assert_eq!(items.len(), 1);
    assert_eq!(items[0].gitlab_project_id, 10001);
    assert_eq!(items[0].path_with_namespace, "group/project-alpha");
  }

  #[tokio::test]
  async fn project_groups_create_and_list() {
    let pool = setup_test_pool().await;

    let empty_groups = list_project_groups(&pool)
      .await
      .expect("list empty project groups");
    assert!(empty_groups.is_empty());

    let group = create_project_group(&pool, "delivery-train".to_string())
      .await
      .expect("create project group");

    assert_eq!(group.name, "delivery-train");
    assert_eq!(group.projects_count, 0);

    let groups = list_project_groups(&pool)
      .await
      .expect("list project groups");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].name, "delivery-train");
    assert_eq!(groups[0].projects_count, 0);

    let empty_projects = list_managed_projects(&pool)
      .await
      .expect("list empty managed projects");
    assert!(empty_projects.is_empty());
  }

  #[tokio::test]
  async fn project_groups_and_managed_projects_are_independent_create_list_flows() {
    let pool = setup_test_pool().await;

    let _group = create_project_group(&pool, "ops".to_string())
      .await
      .expect("create project group");

    let _project = create_managed_project(
      &pool,
      30001,
      "project-three".to_string(),
      "team/project-three".to_string(),
      "D:/repos/project-three".to_string(),
      None,
      None,
      true,
    )
    .await
    .expect("create managed project");

    let groups = list_project_groups(&pool)
      .await
      .expect("list project groups");
    assert_eq!(groups.len(), 1);
    assert_eq!(groups[0].projects_count, 0);

    let projects = list_managed_projects(&pool)
      .await
      .expect("list managed projects");
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].gitlab_project_id, 30001);
  }

  #[tokio::test]
  async fn managed_project_rejects_blank_name_by_constraint() {
    let pool = setup_test_pool().await;

    let result = create_managed_project(
      &pool,
      40001,
      "   ".to_string(),
      "team/project-four".to_string(),
      "D:/repos/project-four".to_string(),
      None,
      None,
      true,
    )
    .await;

    assert!(result.is_err());
  }

  #[tokio::test]
  async fn managed_project_rejects_duplicate_gitlab_project_id() {
    let pool = setup_test_pool().await;

    let first = create_managed_project(
      &pool,
      50001,
      "project-first".to_string(),
      "team/project-first".to_string(),
      "D:/repos/project-first".to_string(),
      None,
      None,
      true,
    )
    .await;
    assert!(first.is_ok());

    let second = create_managed_project(
      &pool,
      50001,
      "project-second".to_string(),
      "team/project-second".to_string(),
      "D:/repos/project-second".to_string(),
      None,
      None,
      true,
    )
    .await;

    assert!(second.is_err());
  }

  #[tokio::test]
  async fn managed_project_update_changes_fields() {
    let pool = setup_test_pool().await;

    let created = create_managed_project(
      &pool,
      60001,
      "project-update-before".to_string(),
      "team/project-update-before".to_string(),
      "D:/repos/project-update-before".to_string(),
      Some("main".to_string()),
      Some("origin".to_string()),
      true,
    )
    .await
    .expect("create managed project");

    update_managed_project(
      &pool,
      created.id,
      60002,
      "project-update-after".to_string(),
      "team/project-update-after".to_string(),
      "D:/repos/project-update-after".to_string(),
      "release".to_string(),
      "upstream".to_string(),
      false,
    )
    .await
    .expect("update managed project");

    let items = list_managed_projects(&pool)
      .await
      .expect("list managed projects");
    assert_eq!(items.len(), 1);
    assert_eq!(items[0].gitlab_project_id, 60002);
    assert_eq!(items[0].name, "project-update-after");
    assert_eq!(items[0].path_with_namespace, "team/project-update-after");
    assert_eq!(items[0].repo_path, "D:/repos/project-update-after");
    assert_eq!(items[0].default_branch, "release");
    assert_eq!(items[0].default_remote, "upstream");
    assert!(!items[0].enabled);
  }

  #[tokio::test]
  async fn managed_project_delete_removes_record() {
    let pool = setup_test_pool().await;

    let created = create_managed_project(
      &pool,
      70001,
      "project-delete".to_string(),
      "team/project-delete".to_string(),
      "D:/repos/project-delete".to_string(),
      None,
      None,
      true,
    )
    .await
    .expect("create managed project");

    delete_managed_project(&pool, created.id)
      .await
      .expect("delete managed project");

    let items = list_managed_projects(&pool)
      .await
      .expect("list managed projects");
    assert!(items.is_empty());
  }
}
