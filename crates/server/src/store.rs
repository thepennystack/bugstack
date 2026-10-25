use serde::{Deserialize, Serialize};
use wasm_bindgen::JsValue;
use worker::{D1Database, Result};

use crate::random;
use crate::sign::SigningClient;

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

pub fn minutes_from_now(minutes: u32) -> String {
    let at = js_sys::Date::now() + f64::from(minutes) * 60_000.0;
    String::from(js_sys::Date::new(&JsValue::from_f64(at)).to_iso_string())
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

pub async fn signing_client(db: &D1Database, client_id: &str) -> Result<Option<SigningClient>> {
    db.prepare("SELECT app_id, status, secret FROM client WHERE client_id = ?1")
        .bind(&[text(client_id)])?
        .first(None)
        .await
}

pub struct NewReport<'a> {
    pub app_id: &'a str,
    pub client_id: &'a str,
    pub title: &'a str,
    pub payload: &'a str,
}

pub async fn insert_report(db: &D1Database, report: &NewReport<'_>) -> Result<String> {
    let report_id = random::id()?;
    let received_at = now();
    db.prepare(
        "INSERT INTO report (report_id, app_id, client_id, received_at, title, payload, status, \
         attempts, next_attempt_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Pending', 0, ?4)",
    )
    .bind(&[
        text(&report_id),
        text(report.app_id),
        text(report.client_id),
        text(&received_at),
        text(report.title),
        text(report.payload),
    ])?
    .run()
    .await?;
    Ok(report_id)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastFailure {
    pub failed_at: String,
    pub step: String,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportRow {
    pub report_id: String,
    pub title: String,
    pub status: String,
    pub attempts: u32,
    pub received_at: String,
    pub client_name: String,
    pub next_attempt_at: String,
    pub issue_url: Option<String>,
    pub slack_posted: bool,
    pub last_failure: Option<LastFailure>,
}

#[derive(Deserialize)]
struct ReportRecord {
    report_id: String,
    title: String,
    status: String,
    attempts: u32,
    received_at: String,
    client_name: String,
    next_attempt_at: String,
    issue_url: Option<String>,
    slack_posted: u8,
    failed_at: Option<String>,
    step: Option<String>,
    message: Option<String>,
}

impl From<ReportRecord> for ReportRow {
    fn from(row: ReportRecord) -> Self {
        let last_failure = match (row.failed_at, row.step, row.message) {
            (Some(failed_at), Some(step), Some(message)) => Some(LastFailure {
                failed_at,
                step,
                message,
            }),
            _ => None,
        };
        ReportRow {
            report_id: row.report_id,
            title: row.title,
            status: row.status,
            attempts: row.attempts,
            received_at: row.received_at,
            client_name: row.client_name,
            next_attempt_at: row.next_attempt_at,
            issue_url: row.issue_url,
            slack_posted: row.slack_posted != 0,
            last_failure,
        }
    }
}

const REPORT_SELECT: &str = "SELECT r.report_id, r.title, r.status, r.attempts, r.received_at, \
     c.name AS client_name, r.next_attempt_at, g.url AS issue_url, \
     (p.report_id IS NOT NULL) AS slack_posted, f.failed_at, f.step, f.message \
     FROM report r \
     JOIN client c ON c.client_id = r.client_id \
     LEFT JOIN github_issue g ON g.report_id = r.report_id \
     LEFT JOIN slack_post p ON p.report_id = r.report_id \
     LEFT JOIN failure f ON f.report_id = r.report_id AND f.failed_at = \
     (SELECT MAX(failed_at) FROM failure WHERE report_id = r.report_id)";

pub async fn list_reports(db: &D1Database, app_id: &str) -> Result<Vec<ReportRow>> {
    let rows: Vec<ReportRecord> = db
        .prepare(format!(
            "{REPORT_SELECT} WHERE r.app_id = ?1 \
             ORDER BY r.received_at DESC, r.report_id DESC LIMIT 100"
        ))
        .bind(&[text(app_id)])?
        .all()
        .await?
        .results()?;
    Ok(rows.into_iter().map(ReportRow::from).collect())
}

pub async fn get_report(db: &D1Database, report_id: &str) -> Result<Option<ReportRow>> {
    let row: Option<ReportRecord> = db
        .prepare(format!("{REPORT_SELECT} WHERE r.report_id = ?1"))
        .bind(&[text(report_id)])?
        .first(None)
        .await?;
    Ok(row.map(ReportRow::from))
}

#[derive(Deserialize)]
struct Attempts {
    attempts: u32,
}

pub async fn claim(db: &D1Database, report_id: &str, lease_until: &str) -> Result<Option<u32>> {
    let claimed: Option<Attempts> = db
        .prepare(
            "UPDATE report SET attempts = attempts + 1, next_attempt_at = ?2 \
             WHERE report_id = ?1 AND status = 'Pending' AND next_attempt_at <= ?3 \
             RETURNING attempts",
        )
        .bind(&[text(report_id), text(lease_until), text(&now())])?
        .first(None)
        .await?;
    Ok(claimed.map(|row| row.attempts))
}

#[derive(Deserialize)]
pub struct Delivery {
    pub title: String,
    pub payload: String,
    pub received_at: String,
    pub client_name: String,
    pub github_installation_id: u64,
    pub github_repo: String,
    pub issue_url: Option<String>,
}

pub async fn delivery(db: &D1Database, report_id: &str) -> Result<Delivery> {
    let row: Option<Delivery> = db
        .prepare(
            "SELECT r.title, r.payload, r.received_at, c.name AS client_name, \
             a.github_installation_id, a.github_repo, g.url AS issue_url \
             FROM report r \
             JOIN client c ON c.client_id = r.client_id \
             JOIN app a ON a.app_id = r.app_id \
             LEFT JOIN github_issue g ON g.report_id = r.report_id \
             WHERE r.report_id = ?1",
        )
        .bind(&[text(report_id)])?
        .first(None)
        .await?;
    row.ok_or_else(|| worker::Error::RustError(format!("report {report_id} vanished after claim")))
}

pub async fn insert_issue(db: &D1Database, report_id: &str, number: u64, url: &str) -> Result<()> {
    db.prepare(
        "INSERT INTO github_issue (report_id, number, url, created_at) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&[
        text(report_id),
        JsValue::from_f64(number as f64),
        text(url),
        text(&now()),
    ])?
    .run()
    .await?;
    Ok(())
}

pub async fn insert_failure(
    db: &D1Database,
    report_id: &str,
    step: &str,
    message: &str,
) -> Result<()> {
    db.prepare("INSERT INTO failure (report_id, failed_at, step, message) VALUES (?1, ?2, ?3, ?4)")
        .bind(&[text(report_id), text(&now()), text(step), text(message)])?
        .run()
        .await?;
    Ok(())
}

pub async fn set_next_attempt(db: &D1Database, report_id: &str, at: &str) -> Result<()> {
    db.prepare("UPDATE report SET next_attempt_at = ?2 WHERE report_id = ?1")
        .bind(&[text(report_id), text(at)])?
        .run()
        .await?;
    Ok(())
}

pub async fn set_status(db: &D1Database, report_id: &str, status: &str) -> Result<()> {
    db.prepare("UPDATE report SET status = ?2 WHERE report_id = ?1")
        .bind(&[text(report_id), text(status)])?
        .run()
        .await?;
    Ok(())
}

#[derive(Deserialize)]
struct Due {
    report_id: String,
}

pub async fn due_reports(db: &D1Database, limit: u32) -> Result<Vec<String>> {
    let rows: Vec<Due> = db
        .prepare(
            "SELECT report_id FROM report WHERE status = 'Pending' AND next_attempt_at <= ?1 \
             ORDER BY next_attempt_at, report_id LIMIT ?2",
        )
        .bind(&[text(&now()), JsValue::from_f64(f64::from(limit))])?
        .all()
        .await?
        .results()?;
    Ok(rows.into_iter().map(|row| row.report_id).collect())
}

pub async fn reset_failed(db: &D1Database, report_id: &str) -> Result<bool> {
    let reset: Option<Due> = db
        .prepare(
            "UPDATE report SET status = 'Pending', attempts = 0, next_attempt_at = ?2 \
             WHERE report_id = ?1 AND status = 'Failed' RETURNING report_id",
        )
        .bind(&[text(report_id), text(&now())])?
        .first(None)
        .await?;
    Ok(reset.is_some())
}
