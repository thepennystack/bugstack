use serde_json::Value;
use worker::*;

use crate::admin::ApiRequest;
use crate::refuse;
use crate::routes::{Checked, created, invalid, no_content, no_route, not_found, text_field};
use crate::slack::{self, OAuthCode, SlackError};
use crate::slack_store::{self, Installed, NewSlackApp};
use crate::store::{self, Removal};

const NAME_MAX: usize = 80;
const CREDENTIAL_MAX: usize = 255;
const CODE_MAX: usize = 255;
const STATE_MINUTES: u32 = 15;
const AUTHORIZE: &str = "https://slack.com/oauth/v2/authorize";
const SCOPE: &str = "chat:write";
const CALLBACK_PATH: &str = "/api/slack/oauth/callback";

fn redirect(status: u16, location: &str) -> Result<Response> {
    let headers = Headers::new();
    headers.set("Location", location)?;
    Ok(Response::empty()?.with_status(status).with_headers(headers))
}

fn redirect_uri(request: &ApiRequest) -> String {
    format!("{}{CALLBACK_PATH}", request.origin)
}

fn new_slack_app(body: &Value) -> Checked<NewSlackApp> {
    Ok(NewSlackApp {
        name: text_field(body, "name", 1, NAME_MAX)?,
        client_id: text_field(body, "clientId", 1, CREDENTIAL_MAX)?,
        client_secret: text_field(body, "clientSecret", 1, CREDENTIAL_MAX)?,
        signing_secret: match body.get("signingSecret") {
            None | Some(Value::Null) => String::new(),
            Some(_) => text_field(body, "signingSecret", 0, CREDENTIAL_MAX)?,
        },
    })
}

async fn create_slack_app(db: &D1Database, body: &Value) -> Result<Response> {
    let app = match new_slack_app(body) {
        Ok(app) => app,
        Err(message) => return invalid(&message),
    };
    created(&slack_store::create_slack_app(db, &app).await?)
}

async fn delete_slack_app(db: &D1Database, slack_app_id: &str) -> Result<Response> {
    match slack_store::delete_slack_app(db, slack_app_id).await? {
        Removal::Removed => no_content(),
        Removal::Missing => not_found("Slack app", slack_app_id),
        Removal::InUse(count) => refuse(
            409,
            "InUse",
            &format!("{count} workspace(s) use this Slack app; delete them first"),
        ),
    }
}

async fn install(db: &D1Database, request: &ApiRequest, slack_app_id: &str) -> Result<Response> {
    let Some(app) = slack_store::get_slack_app(db, slack_app_id).await? else {
        return not_found("Slack app", slack_app_id);
    };
    let state = hex::encode(crate::random::bytes(16)?);
    slack_store::issue_oauth_state(db, &state, slack_app_id, &store::minutes_ago(STATE_MINUTES))
        .await?;
    let redirect_uri = redirect_uri(request);
    let location = Url::parse_with_params(
        AUTHORIZE,
        &[
            ("client_id", app.client_id.as_str()),
            ("scope", SCOPE),
            ("state", state.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
        ],
    )?;
    redirect(302, location.as_str())
}

fn valid_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= CODE_MAX
        && code
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

fn slack_refusal(error: SlackError) -> Result<Response> {
    match error {
        SlackError::Refused { status, error, .. } if (200..300).contains(&status) => refuse(
            400,
            "SlackRefused",
            &format!("Slack oauth.v2.access refused the code: {error}"),
        ),
        error => refuse(
            502,
            "SlackFailed",
            &format!("Slack oauth.v2.access failed: {}", error.failure()),
        ),
    }
}

async fn callback(db: &D1Database, request: &ApiRequest) -> Result<Response> {
    let state = request.param("state").unwrap_or("");
    let consumed = if state.is_empty() {
        None
    } else {
        slack_store::consume_oauth_state(db, state, &store::minutes_ago(STATE_MINUTES)).await?
    };
    let Some(slack_app_id) = consumed else {
        return refuse(
            400,
            "InvalidState",
            "the state is unknown, used or older than 15 minutes; press Add to Slack again",
        );
    };
    if let Some(error) = request.param("error") {
        return refuse(
            400,
            "SlackRefused",
            &format!("Slack did not authorize the install: {error}"),
        );
    }
    let code = request.param("code").unwrap_or("");
    if !valid_code(code) {
        return invalid(&format!("code must be the Slack OAuth code, not {code:?}"));
    }
    let Some(key) = slack_store::slack_app_key(db, &slack_app_id).await? else {
        return not_found("Slack app", &slack_app_id);
    };
    let redirect_uri = redirect_uri(request);
    let installed = slack::oauth_access(&OAuthCode {
        code,
        client_id: &key.client_id,
        client_secret: &key.client_secret,
        redirect_uri: &redirect_uri,
    })
    .await?;
    let installed = match installed {
        Ok(installed) => installed,
        Err(error) => return slack_refusal(error),
    };
    slack_store::upsert_workspace(
        db,
        &Installed {
            slack_app_id: &slack_app_id,
            team_id: &installed.team.id,
            team_name: &installed.team.name,
            bot_token: &installed.access_token,
        },
    )
    .await?;
    redirect(
        303,
        &format!(
            "/slack?installed={}",
            js_sys::encode_uri_component(&installed.team.name)
        ),
    )
}

async fn delete_workspace(db: &D1Database, workspace_id: &str) -> Result<Response> {
    match slack_store::delete_workspace(db, workspace_id).await? {
        Removal::Removed => no_content(),
        Removal::Missing => not_found("Slack workspace", workspace_id),
        Removal::InUse(count) => refuse(
            409,
            "InUse",
            &format!("{count} app(s) post to this workspace; remove their Slack channel first"),
        ),
    }
}

pub async fn route(request: &ApiRequest, env: &Env) -> Result<Response> {
    let segments: Vec<&str> = request
        .path
        .trim_start_matches("/api/slack/")
        .trim_end_matches('/')
        .split('/')
        .collect();
    let db = env.d1("DB")?;
    match (&request.method, segments.as_slice()) {
        (Method::Get, ["apps"]) => Response::from_json(&slack_store::list_slack_apps(&db).await?),
        (Method::Post, ["apps"]) => create_slack_app(&db, &request.body).await,
        (Method::Delete, ["apps", slack_app_id]) => delete_slack_app(&db, slack_app_id).await,
        (Method::Get, ["apps", slack_app_id, "install"]) => {
            install(&db, request, slack_app_id).await
        }
        (Method::Get, ["oauth", "callback"]) => callback(&db, request).await,
        (Method::Get, ["workspaces"]) => {
            Response::from_json(&slack_store::list_workspaces(&db).await?)
        }
        (Method::Delete, ["workspaces", workspace_id]) => delete_workspace(&db, workspace_id).await,
        _ => no_route(request),
    }
}
