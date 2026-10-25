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
    pub org_id: &'a str,
    pub team_id: &'a str,
    pub team_name: &'a str,
    pub bot_token: &'a str,
}

const WORKSPACE_SELECT: &str =
    "SELECT workspace_id, team_id, team_name, created_at FROM slack_workspace";

pub async fn issue_oauth_state(
    db: &D1Database,
    state: &str,
    org_id: &str,
    expired: &str,
) -> Result<()> {
    db.batch(vec![
        db.prepare("DELETE FROM slack_oauth_state WHERE created_at < ?1")
            .bind(&[text(expired)])?,
        db.prepare("INSERT INTO slack_oauth_state (state, org_id, created_at) VALUES (?1, ?2, ?3)")
            .bind(&[text(state), text(org_id), text(&now())])?,
    ])
    .await?;
    Ok(())
}

#[derive(Deserialize)]
struct StateRow {
    org_id: String,
    created_at: String,
}

pub async fn consume_oauth_state(
    db: &D1Database,
    state: &str,
    expired: &str,
) -> Result<Option<String>> {
    let consumed: Option<StateRow> = db
        .prepare("DELETE FROM slack_oauth_state WHERE state = ?1 RETURNING org_id, created_at")
        .bind(&[text(state)])?
        .first(None)
        .await?;
    Ok(consumed
        .filter(|row| row.created_at.as_str() >= expired)
        .map(|row| row.org_id))
}

pub async fn list_workspaces(db: &D1Database, org_id: &str) -> Result<Vec<Workspace>> {
    db.prepare(format!(
        "{WORKSPACE_SELECT} WHERE org_id = ?1 ORDER BY team_name, workspace_id"
    ))
    .bind(&[text(org_id)])?
    .all()
    .await?
    .results()
}

pub async fn get_workspace(
    db: &D1Database,
    org_id: &str,
    workspace_id: &str,
) -> Result<Option<Workspace>> {
    db.prepare(format!(
        "{WORKSPACE_SELECT} WHERE workspace_id = ?1 AND org_id = ?2"
    ))
    .bind(&[text(workspace_id), text(org_id)])?
    .first(None)
    .await
}

#[derive(Deserialize)]
struct OrgId {
    org_id: String,
}

pub async fn upsert_workspace(db: &D1Database, installed: &Installed<'_>) -> Result<bool> {
    let stored: Option<OrgId> = db
        .prepare(
            "INSERT INTO slack_workspace (workspace_id, org_id, team_id, team_name, bot_token, \
             created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (team_id) DO UPDATE SET \
             team_name = excluded.team_name, bot_token = excluded.bot_token, \
             created_at = excluded.created_at \
             WHERE slack_workspace.org_id = excluded.org_id RETURNING org_id",
        )
        .bind(&[
            text(&random::id()?),
            text(installed.org_id),
            text(installed.team_id),
            text(installed.team_name),
            text(installed.bot_token),
            text(&now()),
        ])?
        .first(None)
        .await?;
    Ok(stored.is_some_and(|row| row.org_id == installed.org_id))
}

pub async fn delete_workspace(
    db: &D1Database,
    org_id: &str,
    workspace_id: &str,
) -> Result<Removal> {
    if get_workspace(db, org_id, workspace_id).await?.is_none() {
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
