use serde_json::{Map, Value};
use worker::*;

use crate::github;
use crate::store::{self, Delivery};

const LEASE_MINUTES: u32 = 5;
const BACKOFF_MINUTES: [u32; 5] = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS: u32 = 6;
const SWEEP_LIMIT: u32 = 10;

fn fence(text: &str) -> String {
    let longest = text.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    "`".repeat((longest + 1).max(3))
}

fn fenced(text: &str, language: &str) -> String {
    let fence = fence(text);
    format!("{fence}{language}\n{text}\n{fence}")
}

fn as_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_else(|_| other.to_string()),
    }
}

pub fn issue_body(report_id: &str, report: &Delivery) -> String {
    let fields: Map<String, Value> = match serde_json::from_str(&report.payload) {
        Ok(Value::Object(fields)) => fields,
        _ => Map::new(),
    };
    let mut sections = Vec::new();
    if let Some(error) = fields.get("error") {
        sections.push(fenced(&as_text(error), ""));
    }
    if let Some(body) = fields.get("body") {
        sections.push(as_text(body));
    }
    let rest: Map<String, Value> = fields
        .into_iter()
        .filter(|(key, _)| !matches!(key.as_str(), "title" | "error" | "body"))
        .collect();
    if !rest.is_empty() {
        sections.push(fenced(&as_text(&Value::Object(rest)), "json"));
    }
    sections.push(format!(
        "bugstack report {report_id}, client {}, {}",
        report.client_name, report.received_at
    ));
    sections.join("\n\n")
}

async fn fail(
    db: &D1Database,
    report_id: &str,
    attempts: u32,
    step: &str,
    message: &str,
) -> Result<()> {
    store::insert_failure(db, report_id, step, message).await?;
    if attempts >= MAX_ATTEMPTS {
        return store::set_status(db, report_id, "Failed").await;
    }
    let index = attempts.saturating_sub(1) as usize;
    let wait = BACKOFF_MINUTES[index.min(BACKOFF_MINUTES.len() - 1)];
    store::set_next_attempt(db, report_id, &store::minutes_from_now(wait)).await
}

async fn file_issue(
    env: &Env,
    report_id: &str,
    report: &Delivery,
) -> Result<std::result::Result<String, String>> {
    if let Some(url) = &report.issue_url {
        return Ok(Ok(url.clone()));
    }
    let issue = github::create_issue(
        env,
        report.github_installation_id,
        &report.github_repo,
        &report.title,
        &issue_body(report_id, report),
    )
    .await?;
    match issue {
        Ok(issue) => {
            let db = env.d1("DB")?;
            store::insert_issue(&db, report_id, issue.number, &issue.html_url).await?;
            Ok(Ok(issue.html_url))
        }
        Err(error) => Ok(Err(error.failure())),
    }
}

pub async fn deliver(env: &Env, report_id: &str) -> Result<()> {
    let db = env.d1("DB")?;
    let lease = store::minutes_from_now(LEASE_MINUTES);
    let Some(attempts) = store::claim(&db, report_id, &lease).await? else {
        return Ok(());
    };
    let report = store::delivery(&db, report_id).await?;
    if let Err(message) = file_issue(env, report_id, &report).await? {
        return fail(&db, report_id, attempts, "GitHub", &message).await;
    }
    store::set_status(&db, report_id, "Filed").await
}

pub async fn sweep(env: &Env) -> Result<()> {
    let db = env.d1("DB")?;
    for report_id in store::due_reports(&db, SWEEP_LIMIT).await? {
        deliver(env, &report_id).await?;
    }
    Ok(())
}

pub fn in_background(ctx: &Context, env: &Env, report_id: String) {
    let env = env.clone();
    ctx.wait_until(async move {
        if let Err(error) = deliver(&env, &report_id).await {
            console_error!("delivering report {report_id} failed: {error}");
        }
    });
}
