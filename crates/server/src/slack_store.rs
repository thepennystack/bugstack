use serde::{Deserialize, Serialize};
use wasm_bindgen::JsValue;
use worker::{D1Database, Result};

use crate::random;
use crate::store::{Removal, now};

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

#[derive(Deserialize)]
struct Count {
    count: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    #[serde(alias = "workspace_id")]
    pub workspace_id: String,
    #[serde(alias = "team_id")]
    pub team_id: String,
    #[serde(alias = "team_name")]
    pub team_name: String,
    #[serde(alias = "created_at")]
    pub created_at: String,
}

pub struct Installed<'a> {
    pub team_id: &'a str,
    pub team_name: &'a str,
    pub bot_token: &'a str,
}

const WORKSPACE_SELECT: &str =
    "SELECT workspace_id, team_id, team_name, created_at FROM slack_workspace";

pub async fn issue_oauth_state(db: &D1Database, state: &str, expired: &str) -> Result<()> {
    db.batch(vec![
        db.prepare("DELETE FROM slack_oauth_state WHERE created_at < ?1")
            .bind(&[text(expired)])?,
        db.prepare("INSERT INTO slack_oauth_state (state, created_at) VALUES (?1, ?2)")
            .bind(&[text(state), text(&now())])?,
    ])
    .await?;
    Ok(())
}

#[derive(Deserialize)]
struct StateRow {
    created_at: String,
}

pub async fn consume_oauth_state(db: &D1Database, state: &str, expired: &str) -> Result<bool> {
    let consumed: Option<StateRow> = db
        .prepare("DELETE FROM slack_oauth_state WHERE state = ?1 RETURNING created_at")
        .bind(&[text(state)])?
        .first(None)
        .await?;
    Ok(consumed.is_some_and(|row| row.created_at.as_str() >= expired))
}

pub async fn list_workspaces(db: &D1Database) -> Result<Vec<Workspace>> {
    db.prepare(format!(
        "{WORKSPACE_SELECT} ORDER BY team_name, workspace_id"
    ))
    .all()
    .await?
    .results()
}

pub async fn get_workspace(db: &D1Database, workspace_id: &str) -> Result<Option<Workspace>> {
    db.prepare(format!("{WORKSPACE_SELECT} WHERE workspace_id = ?1"))
        .bind(&[text(workspace_id)])?
        .first(None)
        .await
}

pub async fn upsert_workspace(db: &D1Database, installed: &Installed<'_>) -> Result<()> {
    db.prepare(
        "INSERT INTO slack_workspace (workspace_id, team_id, team_name, bot_token, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (team_id) DO UPDATE SET \
         team_name = excluded.team_name, bot_token = excluded.bot_token, \
         created_at = excluded.created_at",
    )
    .bind(&[
        text(&random::id()?),
        text(installed.team_id),
        text(installed.team_name),
        text(installed.bot_token),
        text(&now()),
    ])?
    .run()
    .await?;
    Ok(())
}

pub async fn delete_workspace(db: &D1Database, workspace_id: &str) -> Result<Removal> {
    if get_workspace(db, workspace_id).await?.is_none() {
        return Ok(Removal::Missing);
    }
    let used: Option<Count> = db
        .prepare("SELECT COUNT(*) AS count FROM slack_channel WHERE workspace_id = ?1")
        .bind(&[text(workspace_id)])?
        .first(None)
        .await?;
    let count = used.map_or(0, |used| used.count);
    if count > 0 {
        return Ok(Removal::InUse(count));
    }
    db.prepare("DELETE FROM slack_workspace WHERE workspace_id = ?1")
        .bind(&[text(workspace_id)])?
        .run()
        .await?;
    Ok(Removal::Removed)
}
