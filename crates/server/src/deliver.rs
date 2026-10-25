use serde_json::{Map, Value};
use worker::*;

use crate::github::{self, Credentials};
use crate::slack;
use crate::store::{self, Delivery};

const LEASE_MINUTES: u32 = 5;
const BACKOFF_MINUTES: [u32; 5] = [1, 5, 30, 120, 720];
const MAX_ATTEMPTS: u32 = 6;
const SWEEP_LIMIT: u32 = 10;
const IMAGE_BASE: &str = "https://bugstack.kattebak.fyi/v1/images";
const NO_GITHUB_APP: &str =
    "NoGitHubApp the app names no stored GitHub App; pick its installation on the app edit page";

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
    if !report.images.is_empty() {
        let lines: Vec<String> = report
            .images
            .iter()
            .enumerate()
            .map(|(index, image_id)| {
                format!("![screenshot {}]({IMAGE_BASE}/{image_id})", index + 1)
            })
            .collect();
        sections.push(lines.join("\n"));
    }
    let rest: Map<String, Value> = fields
        .into_iter()
        .filter(|(key, _)| !matches!(key.as_str(), "title" | "error" | "body" | "images"))
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

fn credentials(report: &Delivery) -> Option<Credentials<'_>> {
    let (Some(app_id_number), Some(private_key)) =
        (report.github_app_number, &report.github_private_key)
    else {
        return None;
    };
    Some(Credentials {
        app_id_number,
        private_key,
    })
}

async fn refresh_issue(
    env: &Env,
    credentials: &Credentials<'_>,
    report_id: &str,
    report: &Delivery,
    url: &str,
    number: u64,
    image_count: u32,
) -> Result<std::result::Result<String, String>> {
    if report.images.len() <= image_count as usize {
        return Ok(Ok(url.to_string()));
    }
    let updated = github::update_issue(
        credentials,
        report.github_installation_id,
        &report.github_repo,
        number,
        &issue_body(report_id, report),
    )
    .await?;
    if let Err(error) = updated {
        return Ok(Err(error.failure()));
    }
    store::set_image_count(&env.d1("DB")?, report_id, report.images.len()).await?;
    Ok(Ok(url.to_string()))
}

async fn file_issue(
    env: &Env,
    report_id: &str,
    report: &Delivery,
) -> Result<std::result::Result<String, String>> {
    let Some(credentials) = credentials(report) else {
        return Ok(Err(NO_GITHUB_APP.to_string()));
    };
    if let (Some(url), Some(number), Some(image_count)) =
        (&report.issue_url, report.issue_number, report.image_count)
    {
        return refresh_issue(
            env,
            &credentials,
            report_id,
            report,
            url,
            number,
            image_count,
        )
        .await;
    }
    let issue = github::create_issue(
        &credentials,
        report.github_installation_id,
        &report.github_repo,
        &report.title,
        &issue_body(report_id, report),
    )
    .await?;
    match issue {
        Ok(issue) => {
            let db = env.d1("DB")?;
            store::insert_issue(
                &db,
                report_id,
                issue.number,
                &issue.html_url,
                report.images.len(),
            )
            .await?;
            Ok(Ok(issue.html_url))
        }
        Err(error) => Ok(Err(error.failure())),
    }
}

pub fn slack_text(report: &Delivery, issue_url: &str) -> String {
    format!(
        "{}: <{}|{}>",
        slack::escape(&report.app_name),
        slack::escape(issue_url),
        slack::escape(&report.title)
    )
}

async fn post_slack(
    db: &D1Database,
    report_id: &str,
    report: &Delivery,
    issue_url: &str,
) -> Result<std::result::Result<(), String>> {
    let (Some(channel), Some(token)) = (&report.slack_channel, &report.slack_token) else {
        return Ok(Ok(()));
    };
    if report.slack_posted != 0 {
        return Ok(Ok(()));
    }
    let posted = slack::post_message(token, channel, &slack_text(report, issue_url)).await?;
    if let Err(error) = posted {
        return Ok(Err(error.failure()));
    }
    store::insert_slack_post(db, report_id).await?;
    Ok(Ok(()))
}

pub async fn deliver(env: &Env, report_id: &str) -> Result<()> {
    let db = env.d1("DB")?;
    let lease = store::minutes_from_now(LEASE_MINUTES);
    let Some(attempts) = store::claim(&db, report_id, &lease).await? else {
        return Ok(());
    };
    let report = store::delivery(&db, report_id).await?;
    let issue_url = match file_issue(env, report_id, &report).await? {
        Ok(url) => url,
        Err(message) => return fail(&db, report_id, attempts, "GitHub", &message).await,
    };
    if let Err(message) = post_slack(&db, report_id, &report, &issue_url).await? {
        return fail(&db, report_id, attempts, "Slack", &message).await;
    }
    if store::file_if_current(&db, report_id).await? {
        return Ok(());
    }
    store::set_next_attempt(&db, report_id, &store::now()).await
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
