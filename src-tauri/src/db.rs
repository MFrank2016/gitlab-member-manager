use crate::models::{LocalGroup, LocalMember, LocalMemberUpsert};
use anyhow::{Context, Result};
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

pub async fn upsert_local_members(pool: &SqlitePool, members: Vec<LocalMemberUpsert>) -> Result<()> {
  let count = members.len();
  tracing::info!(count = count, "[db] upsert_local_members starting");
  
  let mut tx = pool.begin().await?;
  let now = Utc::now().to_rfc3339();

  for m in members {
    sqlx::query(
      r#"INSERT INTO local_members (user_id, username, name, avatar_url, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(user_id) DO UPDATE SET
           username=excluded.username,
           name=excluded.name,
           avatar_url=excluded.avatar_url,
           updated_at=excluded.updated_at
      "#,
    )
    .bind(m.user_id as i64)
    .bind(m.username)
    .bind(m.name)
    .bind(m.avatar_url)
    .bind(&now)
    .execute(&mut *tx)
    .await?;
  }

  tx.commit().await?;
  tracing::info!(count = count, "[db] upsert_local_members completed");
  Ok(())
}

pub async fn list_local_members(pool: &SqlitePool, query: Option<String>) -> Result<Vec<LocalMember>> {
  tracing::debug!(query = ?query, "[db] list_local_members");
  
  let rows = if let Some(q) = query {
    let like = format!("%{}%", q);
    sqlx::query_as::<_, (i64, String, String, Option<String>, String)>(
      r#"SELECT user_id, username, name, avatar_url, updated_at
         FROM local_members
         WHERE username LIKE ?1 OR name LIKE ?1
         ORDER BY updated_at DESC
         LIMIT 500
      "#,
    )
    .bind(like)
    .fetch_all(pool)
    .await?
  } else {
    sqlx::query_as::<_, (i64, String, String, Option<String>, String)>(
      r#"SELECT user_id, username, name, avatar_url, updated_at
         FROM local_members
         ORDER BY updated_at DESC
         LIMIT 500
      "#,
    )
    .fetch_all(pool)
    .await?
  };

  tracing::debug!(count = rows.len(), "[db] list_local_members result");
  
  Ok(
    rows
      .into_iter()
      .map(|r| LocalMember {
        user_id: r.0 as u64,
        username: r.1,
        name: r.2,
        avatar_url: r.3,
        updated_at: r.4,
      })
      .collect(),
  )
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
  
  let rows = sqlx::query_as::<_, (i64, String, String, Option<String>, String)>(
    r#"SELECT m.user_id, m.username, m.name, m.avatar_url, m.updated_at
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
      })
      .collect(),
  )
}
