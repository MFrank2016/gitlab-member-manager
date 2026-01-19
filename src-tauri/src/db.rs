use crate::models::{LocalGroup, LocalMember, LocalMemberUpsert};
use anyhow::{Context, Result};
use chrono::Utc;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use tauri::Manager;

pub async fn init_db(app: &tauri::AppHandle) -> Result<SqlitePool> {
  let dir = app
    .path()
    .app_data_dir()
    .context("failed to resolve app_data_dir")?;
  std::fs::create_dir_all(&dir).context("failed to create app data dir")?;

  let db_path = dir.join("gitlab_member_manager.sqlite3");
  let db_url = format!("sqlite://{}", db_path.to_string_lossy());

  let pool = SqlitePoolOptions::new()
    .max_connections(5)
    .connect(&db_url)
    .await
    .context("failed to connect sqlite")?;

  static MIGRATOR: Migrator = sqlx::migrate!();
  MIGRATOR.run(&pool).await?;

  Ok(pool)
}

pub async fn upsert_local_members(pool: &SqlitePool, members: Vec<LocalMemberUpsert>) -> Result<()> {
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
  Ok(())
}

pub async fn list_local_members(pool: &SqlitePool, query: Option<String>) -> Result<Vec<LocalMember>> {
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
  let now = Utc::now().to_rfc3339();
  let res = sqlx::query(
    r#"INSERT INTO local_groups (name, created_at) VALUES (?1, ?2)"#,
  )
  .bind(&name)
  .bind(&now)
  .execute(pool)
  .await?;

  let id = res.last_insert_rowid();
  Ok(LocalGroup { id, name, created_at: now })
}

pub async fn list_local_groups(pool: &SqlitePool) -> Result<Vec<LocalGroup>> {
  let rows = sqlx::query_as::<_, (i64, String, String)>(
    r#"SELECT id, name, created_at FROM local_groups ORDER BY id DESC"#,
  )
  .fetch_all(pool)
  .await?;

  Ok(
    rows
      .into_iter()
      .map(|r| LocalGroup {
        id: r.0,
        name: r.1,
        created_at: r.2,
      })
      .collect(),
  )
}

pub async fn add_members_to_group(pool: &SqlitePool, group_id: i64, user_ids: Vec<u64>) -> Result<()> {
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
  Ok(())
}

pub async fn remove_members_from_group(pool: &SqlitePool, group_id: i64, user_ids: Vec<u64>) -> Result<()> {
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
  Ok(())
}

pub async fn list_group_members(pool: &SqlitePool, group_id: i64) -> Result<Vec<LocalMember>> {
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
