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
pub struct SlackApp {
    #[serde(alias = "slack_app_id")]
    pub slack_app_id: String,
    pub name: String,
    #[serde(alias = "client_id")]
    pub client_id: String,
    #[serde(alias = "created_at")]
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct SlackAppKey {
    pub client_id: String,
    pub client_secret: String,
}

pub struct NewSlackApp {
    pub name: String,
    pub client_id: String,
    pub client_secret: String,
    pub signing_secret: String,
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
    #[serde(alias = "slack_app_id")]
    pub slack_app_id: String,
    #[serde(alias = "slack_app_name")]
    pub slack_app_name: String,
    #[serde(alias = "created_at")]
    pub created_at: String,
}

pub struct Installed<'a> {
    pub slack_app_id: &'a str,
    pub team_id: &'a str,
    pub team_name: &'a str,
    pub bot_token: &'a str,
}

const SLACK_APP_SELECT: &str = "SELECT slack_app_id, name, client_id, created_at FROM slack_app";

const WORKSPACE_SELECT: &str = "SELECT w.workspace_id, w.team_id, w.team_name, \
     w.slack_app_id, a.name AS slack_app_name, w.created_at \
     FROM slack_workspace w JOIN slack_app a ON a.slack_app_id = w.slack_app_id";

pub async fn list_slack_apps(db: &D1Database) -> Result<Vec<SlackApp>> {
    db.prepare(format!(
        "{SLACK_APP_SELECT} ORDER BY created_at, slack_app_id"
    ))
    .all()
    .await?
    .results()
}

pub async fn get_slack_app(db: &D1Database, slack_app_id: &str) -> Result<Option<SlackApp>> {
    db.prepare(format!("{SLACK_APP_SELECT} WHERE slack_app_id = ?1"))
        .bind(&[text(slack_app_id)])?
        .first(None)
        .await
}

pub async fn slack_app_key(db: &D1Database, slack_app_id: &str) -> Result<Option<SlackAppKey>> {
    db.prepare("SELECT client_id, client_secret FROM slack_app WHERE slack_app_id = ?1")
        .bind(&[text(slack_app_id)])?
        .first(None)
        .await
}

pub async fn create_slack_app(db: &D1Database, app: &NewSlackApp) -> Result<SlackApp> {
    let slack_app_id = random::id()?;
    db.prepare(
        "INSERT INTO slack_app (slack_app_id, name, client_id, client_secret, signing_secret, \
         created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&[
        text(&slack_app_id),
        text(&app.name),
        text(&app.client_id),
        text(&app.client_secret),
        text(&app.signing_secret),
        text(&now()),
    ])?
    .run()
    .await?;
    get_slack_app(db, &slack_app_id).await?.ok_or_else(|| {
        worker::Error::RustError(format!("Slack app {slack_app_id} vanished after insert"))
    })
}

pub async fn delete_slack_app(db: &D1Database, slack_app_id: &str) -> Result<Removal> {
    if get_slack_app(db, slack_app_id).await?.is_none() {
        return Ok(Removal::Missing);
    }
    let used: Option<Count> = db
        .prepare("SELECT COUNT(*) AS count FROM slack_workspace WHERE slack_app_id = ?1")
        .bind(&[text(slack_app_id)])?
        .first(None)
        .await?;
    let count = used.map_or(0, |used| used.count);
    if count > 0 {
        return Ok(Removal::InUse(count));
    }
    db.batch(vec![
        db.prepare("DELETE FROM slack_oauth_state WHERE slack_app_id = ?1")
            .bind(&[text(slack_app_id)])?,
        db.prepare("DELETE FROM slack_app WHERE slack_app_id = ?1")
            .bind(&[text(slack_app_id)])?,
    ])
    .await?;
    Ok(Removal::Removed)
}

pub async fn issue_oauth_state(
    db: &D1Database,
    state: &str,
    slack_app_id: &str,
    expired: &str,
) -> Result<()> {
    db.batch(vec![
        db.prepare("DELETE FROM slack_oauth_state WHERE created_at < ?1")
            .bind(&[text(expired)])?,
        db.prepare(
            "INSERT INTO slack_oauth_state (state, slack_app_id, created_at) VALUES (?1, ?2, ?3)",
        )
        .bind(&[text(state), text(slack_app_id), text(&now())])?,
    ])
    .await?;
    Ok(())
}

#[derive(Deserialize)]
struct StateRow {
    slack_app_id: String,
    created_at: String,
}

pub async fn consume_oauth_state(
    db: &D1Database,
    state: &str,
    expired: &str,
) -> Result<Option<String>> {
    let consumed: Option<StateRow> = db
        .prepare(
            "DELETE FROM slack_oauth_state WHERE state = ?1 RETURNING slack_app_id, created_at",
        )
        .bind(&[text(state)])?
        .first(None)
        .await?;
    Ok(consumed
        .filter(|row| row.created_at.as_str() >= expired)
        .map(|row| row.slack_app_id))
}

pub async fn list_workspaces(db: &D1Database) -> Result<Vec<Workspace>> {
    db.prepare(format!(
        "{WORKSPACE_SELECT} ORDER BY w.team_name, w.workspace_id"
    ))
    .all()
    .await?
    .results()
}

pub async fn get_workspace(db: &D1Database, workspace_id: &str) -> Result<Option<Workspace>> {
    db.prepare(format!("{WORKSPACE_SELECT} WHERE w.workspace_id = ?1"))
        .bind(&[text(workspace_id)])?
        .first(None)
        .await
}

pub async fn upsert_workspace(db: &D1Database, installed: &Installed<'_>) -> Result<()> {
    db.prepare(
        "INSERT INTO slack_workspace (workspace_id, slack_app_id, team_id, team_name, bot_token, \
         created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (team_id) DO UPDATE SET \
         slack_app_id = excluded.slack_app_id, team_name = excluded.team_name, \
         bot_token = excluded.bot_token, created_at = excluded.created_at",
    )
    .bind(&[
        text(&random::id()?),
        text(installed.slack_app_id),
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
