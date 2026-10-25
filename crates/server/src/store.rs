use serde::{Deserialize, Serialize};
use wasm_bindgen::JsValue;
use worker::{D1Database, Result};

use crate::random;

const APP_SELECT: &str = "SELECT a.app_id, a.name, a.description, a.github_installation_id, \
     a.github_repo, a.created_at, s.workspace_id, s.channel \
     FROM app a LEFT JOIN slack_channel s ON s.app_id = a.app_id";

const CLIENT_SELECT: &str = "SELECT client_id, name, status, created_at FROM client";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Slack {
    pub workspace_id: String,
    pub channel: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub app_id: String,
    pub name: String,
    pub description: String,
    pub installation_id: u64,
    pub github_repo: String,
    pub slack: Option<Slack>,
    pub created_at: String,
}

#[derive(Deserialize)]
struct AppRow {
    app_id: String,
    name: String,
    description: String,
    github_installation_id: u64,
    github_repo: String,
    created_at: String,
    workspace_id: Option<String>,
    channel: Option<String>,
}

impl From<AppRow> for App {
    fn from(row: AppRow) -> Self {
        let slack = match (row.workspace_id, row.channel) {
            (Some(workspace_id), Some(channel)) => Some(Slack {
                workspace_id,
                channel,
            }),
            _ => None,
        };
        App {
            app_id: row.app_id,
            name: row.name,
            description: row.description,
            installation_id: row.github_installation_id,
            github_repo: row.github_repo,
            slack,
            created_at: row.created_at,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub client_id: String,
    pub name: String,
    pub status: String,
    pub created_at: String,
}

#[derive(Deserialize)]
struct ClientRow {
    client_id: String,
    name: String,
    status: String,
    created_at: String,
}

impl From<ClientRow> for Client {
    fn from(row: ClientRow) -> Self {
        Client {
            client_id: row.client_id,
            name: row.name,
            status: row.status,
            created_at: row.created_at,
        }
    }
}

pub struct AppInput {
    pub name: String,
    pub description: String,
    pub installation_id: u64,
    pub github_repo: String,
}

pub fn now() -> String {
    String::from(js_sys::Date::new_0().to_iso_string())
}

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

pub async fn list_apps(db: &D1Database) -> Result<Vec<App>> {
    let rows: Vec<AppRow> = db
        .prepare(format!("{APP_SELECT} ORDER BY a.created_at DESC"))
        .all()
        .await?
        .results()?;
    Ok(rows.into_iter().map(App::from).collect())
}

pub async fn get_app(db: &D1Database, app_id: &str) -> Result<Option<App>> {
    let row: Option<AppRow> = db
        .prepare(format!("{APP_SELECT} WHERE a.app_id = ?1"))
        .bind(&[text(app_id)])?
        .first(None)
        .await?;
    Ok(row.map(App::from))
}

pub async fn create_app(db: &D1Database, input: &AppInput) -> Result<App> {
    let app_id = random::id()?;
    db.prepare(
        "INSERT INTO app (app_id, name, description, github_installation_id, github_repo, \
         created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
    )
    .bind(&[
        text(&app_id),
        text(&input.name),
        text(&input.description),
        JsValue::from_f64(input.installation_id as f64),
        text(&input.github_repo),
        text(&now()),
    ])?
    .run()
    .await?;
    get_app(db, &app_id)
        .await?
        .ok_or_else(|| worker::Error::RustError(format!("app {app_id} vanished after insert")))
}

pub async fn update_app(db: &D1Database, app_id: &str, input: &AppInput) -> Result<Option<App>> {
    db.prepare(
        "UPDATE app SET name = ?2, description = ?3, github_installation_id = ?4, \
         github_repo = ?5 WHERE app_id = ?1",
    )
    .bind(&[
        text(app_id),
        text(&input.name),
        text(&input.description),
        JsValue::from_f64(input.installation_id as f64),
        text(&input.github_repo),
    ])?
    .run()
    .await?;
    get_app(db, app_id).await
}

pub async fn list_clients(db: &D1Database, app_id: &str) -> Result<Vec<Client>> {
    let rows: Vec<ClientRow> = db
        .prepare(format!(
            "{CLIENT_SELECT} WHERE app_id = ?1 ORDER BY created_at, client_id"
        ))
        .bind(&[text(app_id)])?
        .all()
        .await?
        .results()?;
    Ok(rows.into_iter().map(Client::from).collect())
}

pub async fn get_client(db: &D1Database, client_id: &str) -> Result<Option<Client>> {
    let row: Option<ClientRow> = db
        .prepare(format!("{CLIENT_SELECT} WHERE client_id = ?1"))
        .bind(&[text(client_id)])?
        .first(None)
        .await?;
    Ok(row.map(Client::from))
}

pub async fn create_client(
    db: &D1Database,
    app_id: &str,
    name: &str,
    secret: &str,
) -> Result<Client> {
    let client_id = random::id()?;
    db.prepare(
        "INSERT INTO client (client_id, app_id, name, secret, status, created_at) \
         VALUES (?1, ?2, ?3, ?4, 'Active', ?5)",
    )
    .bind(&[
        text(&client_id),
        text(app_id),
        text(name),
        text(secret),
        text(&now()),
    ])?
    .run()
    .await?;
    get_client(db, &client_id).await?.ok_or_else(|| {
        worker::Error::RustError(format!("client {client_id} vanished after insert"))
    })
}

pub async fn revoke_client(db: &D1Database, client_id: &str) -> Result<Option<Client>> {
    db.prepare("UPDATE client SET status = 'Revoked' WHERE client_id = ?1")
        .bind(&[text(client_id)])?
        .run()
        .await?;
    get_client(db, client_id).await
}
