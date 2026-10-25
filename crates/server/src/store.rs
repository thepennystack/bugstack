use serde::{Deserialize, Deserializer, Serialize};
use wasm_bindgen::JsValue;
use worker::{D1Database, Result};

use crate::random;
use crate::sign::SigningClient;

const APP_SELECT: &str = "SELECT a.app_id, a.name, a.description, a.github_app_id, \
     a.github_installation_id, a.github_repo, a.created_at, s.workspace_id, s.channel, \
     (SELECT COUNT(*) FROM client c WHERE c.app_id = a.app_id AND c.status = 'Active') AS clients, \
     (SELECT COUNT(*) FROM report r WHERE r.app_id = a.app_id AND r.status = 'Pending') AS pending, \
     (SELECT COUNT(*) FROM report r WHERE r.app_id = a.app_id AND r.status = 'Filed') AS filed, \
     (SELECT COUNT(*) FROM report r WHERE r.app_id = a.app_id AND r.status = 'Failed') AS failed \
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
pub struct Counts {
    pub clients: u64,
    pub pending: u64,
    pub filed: u64,
    pub failed: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct App {
    pub app_id: String,
    pub name: String,
    pub description: String,
    pub github_app_id: String,
    pub installation_id: u64,
    pub github_repo: String,
    pub slack: Option<Slack>,
    pub counts: Counts,
    pub created_at: String,
}

#[derive(Deserialize)]
struct AppRow {
    app_id: String,
    name: String,
    description: String,
    github_app_id: String,
    github_installation_id: u64,
    github_repo: String,
    created_at: String,
    workspace_id: Option<String>,
    channel: Option<String>,
    clients: u64,
    pending: u64,
    filed: u64,
    failed: u64,
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
            github_app_id: row.github_app_id,
            installation_id: row.github_installation_id,
            github_repo: row.github_repo,
            slack,
            counts: Counts {
                clients: row.clients,
                pending: row.pending,
                filed: row.filed,
                failed: row.failed,
            },
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
    pub github_app_id: String,
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
         created_at, github_app_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )
    .bind(&[
        text(&app_id),
        text(&input.name),
        text(&input.description),
        JsValue::from_f64(input.installation_id as f64),
        text(&input.github_repo),
        text(&now()),
        text(&input.github_app_id),
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
         github_repo = ?5, github_app_id = ?6 WHERE app_id = ?1",
    )
    .bind(&[
        text(app_id),
        text(&input.name),
        text(&input.description),
        JsValue::from_f64(input.installation_id as f64),
        text(&input.github_repo),
        text(&input.github_app_id),
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

#[derive(Deserialize)]
struct ClientId {
    #[serde(rename = "client_id")]
    _client_id: String,
}

pub enum ClientRemoval {
    Removed,
    Missing,
    NotRevoked(String),
}

pub async fn delete_client(db: &D1Database, client_id: &str) -> Result<ClientRemoval> {
    let deleted: Option<ClientId> = db
        .prepare(
            "DELETE FROM client WHERE client_id = ?1 AND status = 'Revoked' RETURNING client_id",
        )
        .bind(&[text(client_id)])?
        .first(None)
        .await?;
    if deleted.is_some() {
        return Ok(ClientRemoval::Removed);
    }
    Ok(match get_client(db, client_id).await? {
        Some(client) => ClientRemoval::NotRevoked(client.status),
        None => ClientRemoval::Missing,
    })
}

#[derive(Deserialize)]
struct ImageId {
    image_id: String,
}

const APP_REPORTS: &str = "SELECT report_id FROM report WHERE app_id = ?1";

pub async fn delete_app(db: &D1Database, app_id: &str) -> Result<Option<Vec<String>>> {
    if get_app(db, app_id).await?.is_none() {
        return Ok(None);
    }
    let images: Vec<ImageId> = db
        .prepare(format!(
            "SELECT image_id FROM image WHERE report_id IN ({APP_REPORTS})"
        ))
        .bind(&[text(app_id)])?
        .all()
        .await?
        .results()?;
    let statements = [
        format!("DELETE FROM image WHERE report_id IN ({APP_REPORTS})"),
        format!("DELETE FROM github_issue WHERE report_id IN ({APP_REPORTS})"),
        format!("DELETE FROM slack_post WHERE report_id IN ({APP_REPORTS})"),
        format!("DELETE FROM failure WHERE report_id IN ({APP_REPORTS})"),
        "DELETE FROM report WHERE app_id = ?1".into(),
        "DELETE FROM client WHERE app_id = ?1".into(),
        "DELETE FROM slack_channel WHERE app_id = ?1".into(),
        "DELETE FROM app WHERE app_id = ?1".into(),
    ]
    .into_iter()
    .map(|sql| db.prepare(sql).bind(&[text(app_id)]))
    .collect::<Result<Vec<_>>>()?;
    db.batch(statements).await?;
    Ok(Some(images.into_iter().map(|row| row.image_id).collect()))
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
    pub images: &'a [DeclaredImage],
}

pub struct DeclaredImage {
    pub content_type: String,
    pub size: u64,
}

pub struct InsertedReport {
    pub report_id: String,
    pub image_ids: Vec<String>,
}

pub async fn insert_report(db: &D1Database, report: &NewReport<'_>) -> Result<InsertedReport> {
    let report_id = random::id()?;
    let received_at = now();
    let mut statements = vec![
        db.prepare(
            "INSERT INTO report (report_id, app_id, client_id, received_at, title, payload, \
             status, attempts, next_attempt_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'Pending', 0, ?4)",
        )
        .bind(&[
            text(&report_id),
            text(report.app_id),
            text(report.client_id),
            text(&received_at),
            text(report.title),
            text(report.payload),
        ])?,
    ];
    let mut image_ids = Vec::with_capacity(report.images.len());
    for (position, image) in report.images.iter().enumerate() {
        let image_id = random::id()?;
        statements.push(
            db.prepare(
                "INSERT INTO image (image_id, report_id, position, content_type, size, status, \
                 created_at) VALUES (?1, ?2, ?3, ?4, ?5, 'Reserved', ?6)",
            )
            .bind(&[
                text(&image_id),
                text(&report_id),
                JsValue::from_f64(position as f64),
                text(&image.content_type),
                JsValue::from_f64(image.size as f64),
                text(&received_at),
            ])?,
        );
        image_ids.push(image_id);
    }
    db.batch(statements).await?;
    Ok(InsertedReport {
        report_id,
        image_ids,
    })
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
    pub images: Vec<String>,
}

#[derive(Deserialize)]
struct ReportRecord {
    report_id: String,
    title: String,
    status: String,
    attempts: u32,
    received_at: String,
    #[serde(deserialize_with = "client_name")]
    client_name: String,
    next_attempt_at: String,
    issue_url: Option<String>,
    slack_posted: u8,
    failed_at: Option<String>,
    step: Option<String>,
    message: Option<String>,
    #[serde(deserialize_with = "json_ids")]
    images: Vec<String>,
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
            images: row.images,
        }
    }
}

fn json_ids<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Vec<String>, D::Error> {
    let raw = String::deserialize(deserializer)?;
    serde_json::from_str(&raw).map_err(serde::de::Error::custom)
}

const DELETED_CLIENT: &str = "deleted client";

fn client_name<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<String, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.unwrap_or_else(|| DELETED_CLIENT.into()))
}

const REPORT_SELECT: &str = "SELECT r.report_id, r.title, r.status, r.attempts, r.received_at, \
     c.name AS client_name, r.next_attempt_at, g.url AS issue_url, \
     (p.report_id IS NOT NULL) AS slack_posted, f.failed_at, f.step, f.message, \
     (SELECT json_group_array(image_id) FROM (SELECT image_id FROM image \
     WHERE report_id = r.report_id AND status = 'Stored' ORDER BY position)) AS images \
     FROM report r \
     LEFT JOIN client c ON c.client_id = r.client_id \
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
    #[serde(deserialize_with = "client_name")]
    pub client_name: String,
    pub github_installation_id: u64,
    pub github_repo: String,
    pub github_app_number: Option<u64>,
    pub github_private_key: Option<String>,
    pub issue_url: Option<String>,
    pub issue_number: Option<u64>,
    pub image_count: Option<u32>,
    pub app_name: String,
    pub slack_channel: Option<String>,
    pub slack_token: Option<String>,
    pub slack_posted: u8,
    #[serde(deserialize_with = "json_ids")]
    pub images: Vec<String>,
}

pub async fn delivery(db: &D1Database, report_id: &str) -> Result<Delivery> {
    let row: Option<Delivery> = db
        .prepare(
            "SELECT r.title, r.payload, r.received_at, c.name AS client_name, \
             a.github_installation_id, a.github_repo, h.app_id_number AS github_app_number, \
             h.private_key AS github_private_key, g.url AS issue_url, \
             g.number AS issue_number, g.image_count, a.name AS app_name, s.channel AS slack_channel, w.bot_token AS slack_token, \
             (p.report_id IS NOT NULL) AS slack_posted, \
             (SELECT json_group_array(image_id) FROM (SELECT image_id FROM image \
             WHERE report_id = r.report_id AND status = 'Stored' ORDER BY position)) AS images \
             FROM report r \
             LEFT JOIN client c ON c.client_id = r.client_id \
             JOIN app a ON a.app_id = r.app_id \
             LEFT JOIN github_app h ON h.github_app_id = a.github_app_id \
             LEFT JOIN github_issue g ON g.report_id = r.report_id \
             LEFT JOIN slack_channel s ON s.app_id = r.app_id \
             LEFT JOIN slack_workspace w ON w.workspace_id = s.workspace_id \
             LEFT JOIN slack_post p ON p.report_id = r.report_id \
             WHERE r.report_id = ?1",
        )
        .bind(&[text(report_id)])?
        .first(None)
        .await?;
    row.ok_or_else(|| worker::Error::RustError(format!("report {report_id} vanished after claim")))
}

pub async fn insert_issue(
    db: &D1Database,
    report_id: &str,
    number: u64,
    url: &str,
    image_count: usize,
) -> Result<()> {
    db.prepare(
        "INSERT INTO github_issue (report_id, number, url, image_count, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )
    .bind(&[
        text(report_id),
        JsValue::from_f64(number as f64),
        text(url),
        JsValue::from_f64(image_count as f64),
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

pub enum Removal {
    Removed,
    Missing,
    InUse(u32),
}

#[derive(Deserialize)]
struct Count {
    count: u32,
}

pub async fn set_app_slack(
    db: &D1Database,
    app_id: &str,
    workspace_id: &str,
    channel: &str,
) -> Result<()> {
    db.prepare(
        "INSERT INTO slack_channel (app_id, workspace_id, channel, created_at) \
         VALUES (?1, ?2, ?3, ?4) ON CONFLICT (app_id) DO UPDATE SET \
         workspace_id = excluded.workspace_id, channel = excluded.channel",
    )
    .bind(&[
        text(app_id),
        text(workspace_id),
        text(channel),
        text(&now()),
    ])?
    .run()
    .await?;
    Ok(())
}

pub async fn delete_app_slack(db: &D1Database, app_id: &str) -> Result<()> {
    db.prepare("DELETE FROM slack_channel WHERE app_id = ?1")
        .bind(&[text(app_id)])?
        .run()
        .await?;
    Ok(())
}

pub async fn insert_slack_post(db: &D1Database, report_id: &str) -> Result<()> {
    db.prepare("INSERT INTO slack_post (report_id, posted_at) VALUES (?1, ?2)")
        .bind(&[text(report_id), text(&now())])?
        .run()
        .await?;
    Ok(())
}

pub const STORED: &str = "Stored";

#[derive(Deserialize)]
pub struct Image {
    pub report_id: String,
    pub content_type: String,
    pub size: u64,
    pub status: String,
}

pub async fn get_image(db: &D1Database, image_id: &str) -> Result<Option<Image>> {
    db.prepare("SELECT report_id, content_type, size, status FROM image WHERE image_id = ?1")
        .bind(&[text(image_id)])?
        .first(None)
        .await
}

pub async fn set_image_stored(db: &D1Database, image_id: &str) -> Result<()> {
    db.prepare("UPDATE image SET status = 'Stored' WHERE image_id = ?1")
        .bind(&[text(image_id)])?
        .run()
        .await?;
    Ok(())
}

pub async fn requeue_filed(db: &D1Database, report_id: &str) -> Result<bool> {
    let requeued: Option<Due> = db
        .prepare(
            "UPDATE report SET status = 'Pending', next_attempt_at = ?2 \
             WHERE report_id = ?1 AND status = 'Filed' RETURNING report_id",
        )
        .bind(&[text(report_id), text(&now())])?
        .first(None)
        .await?;
    Ok(requeued.is_some())
}

pub async fn set_image_count(db: &D1Database, report_id: &str, image_count: usize) -> Result<()> {
    db.prepare("UPDATE github_issue SET image_count = ?2 WHERE report_id = ?1")
        .bind(&[text(report_id), JsValue::from_f64(image_count as f64)])?
        .run()
        .await?;
    Ok(())
}

pub async fn file_if_current(db: &D1Database, report_id: &str) -> Result<bool> {
    let filed: Option<Due> = db
        .prepare(
            "UPDATE report SET status = 'Filed' WHERE report_id = ?1 AND \
             (SELECT COUNT(*) FROM image WHERE report_id = ?1 AND status = 'Stored') <= \
             (SELECT image_count FROM github_issue WHERE report_id = ?1) \
             RETURNING report_id",
        )
        .bind(&[text(report_id)])?
        .first(None)
        .await?;
    Ok(filed.is_some())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubApp {
    #[serde(alias = "github_app_id")]
    pub github_app_id: String,
    #[serde(alias = "app_id_number")]
    pub app_id_number: u64,
    pub slug: String,
    pub name: String,
    #[serde(alias = "owner_login")]
    pub owner_login: String,
    #[serde(alias = "html_url")]
    pub html_url: String,
    #[serde(alias = "created_at")]
    pub created_at: String,
}

#[derive(Deserialize)]
pub struct GitHubAppKey {
    pub github_app_id: String,
    pub app_id_number: u64,
    pub slug: String,
    pub private_key: String,
}

pub struct NewGitHubApp<'a> {
    pub app_id_number: u64,
    pub slug: &'a str,
    pub name: &'a str,
    pub owner_login: &'a str,
    pub private_key: &'a str,
    pub client_id: &'a str,
    pub client_secret: &'a str,
    pub webhook_secret: &'a str,
    pub html_url: &'a str,
}

const GITHUB_APP_SELECT: &str = "SELECT github_app_id, app_id_number, slug, name, owner_login, \
     html_url, created_at FROM github_app";

const GITHUB_APP_KEY_SELECT: &str =
    "SELECT github_app_id, app_id_number, slug, private_key FROM github_app";

pub async fn list_github_apps(db: &D1Database) -> Result<Vec<GitHubApp>> {
    db.prepare(format!(
        "{GITHUB_APP_SELECT} ORDER BY created_at, github_app_id"
    ))
    .all()
    .await?
    .results()
}

pub async fn get_github_app(db: &D1Database, github_app_id: &str) -> Result<Option<GitHubApp>> {
    db.prepare(format!("{GITHUB_APP_SELECT} WHERE github_app_id = ?1"))
        .bind(&[text(github_app_id)])?
        .first(None)
        .await
}

pub async fn github_app_keys(db: &D1Database) -> Result<Vec<GitHubAppKey>> {
    db.prepare(format!(
        "{GITHUB_APP_KEY_SELECT} ORDER BY created_at, github_app_id"
    ))
    .all()
    .await?
    .results()
}

pub async fn github_app_key(db: &D1Database, github_app_id: &str) -> Result<Option<GitHubAppKey>> {
    db.prepare(format!("{GITHUB_APP_KEY_SELECT} WHERE github_app_id = ?1"))
        .bind(&[text(github_app_id)])?
        .first(None)
        .await
}

pub async fn insert_github_app(db: &D1Database, app: &NewGitHubApp<'_>) -> Result<String> {
    let github_app_id = random::id()?;
    db.prepare(
        "INSERT INTO github_app (github_app_id, app_id_number, slug, name, owner_login, \
         private_key, client_id, client_secret, webhook_secret, html_url, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
    )
    .bind(&[
        text(&github_app_id),
        JsValue::from_f64(app.app_id_number as f64),
        text(app.slug),
        text(app.name),
        text(app.owner_login),
        text(app.private_key),
        text(app.client_id),
        text(app.client_secret),
        text(app.webhook_secret),
        text(app.html_url),
        text(&now()),
    ])?
    .run()
    .await?;
    Ok(github_app_id)
}

pub async fn delete_github_app(db: &D1Database, github_app_id: &str) -> Result<Removal> {
    if get_github_app(db, github_app_id).await?.is_none() {
        return Ok(Removal::Missing);
    }
    let used: Option<Count> = db
        .prepare("SELECT COUNT(*) AS count FROM app WHERE github_app_id = ?1")
        .bind(&[text(github_app_id)])?
        .first(None)
        .await?;
    let count = used.map_or(0, |used| used.count);
    if count > 0 {
        return Ok(Removal::InUse(count));
    }
    db.prepare("DELETE FROM github_app WHERE github_app_id = ?1")
        .bind(&[text(github_app_id)])?
        .run()
        .await?;
    Ok(Removal::Removed)
}

pub fn minutes_ago(minutes: u32) -> String {
    let at = js_sys::Date::now() - f64::from(minutes) * 60_000.0;
    String::from(js_sys::Date::new(&JsValue::from_f64(at)).to_iso_string())
}

pub async fn issue_github_app_state(db: &D1Database, state: &str, expired: &str) -> Result<()> {
    db.batch(vec![
        db.prepare("DELETE FROM github_app_state WHERE created_at < ?1")
            .bind(&[text(expired)])?,
        db.prepare("INSERT INTO github_app_state (state, created_at) VALUES (?1, ?2)")
            .bind(&[text(state), text(&now())])?,
    ])
    .await?;
    Ok(())
}

#[derive(Deserialize)]
struct StateRow {
    created_at: String,
}

pub async fn consume_github_app_state(db: &D1Database, state: &str, expired: &str) -> Result<bool> {
    let consumed: Option<StateRow> = db
        .prepare("DELETE FROM github_app_state WHERE state = ?1 RETURNING created_at")
        .bind(&[text(state)])?
        .first(None)
        .await?;
    Ok(consumed.is_some_and(|row| row.created_at.as_str() >= expired))
}
