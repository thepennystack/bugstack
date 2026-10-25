use worker::*;

use crate::admin::ApiRequest;
use crate::fixtures;
use crate::refuse;
use crate::routes::{invalid, no_content, no_route, not_found};
use crate::slack::{self, OAuthCode, SlackError};
use crate::slack_store::{self, Installed};
use crate::store::{self, Removal};

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

async fn install(env: &Env, request: &ApiRequest) -> Result<Response> {
    let fixture = match fixtures::slack(env) {
        Ok(fixture) => fixture,
        Err(missing) => return missing.response(),
    };
    let db = env.d1("DB")?;
    let state = hex::encode(crate::random::bytes(16)?);
    slack_store::issue_oauth_state(&db, &state, &store::minutes_ago(STATE_MINUTES)).await?;
    let redirect_uri = redirect_uri(request);
    let location = Url::parse_with_params(
        AUTHORIZE,
        &[
            ("client_id", fixture.client_id.as_str()),
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

async fn callback(env: &Env, request: &ApiRequest) -> Result<Response> {
    let db = env.d1("DB")?;
    let state = request.param("state").unwrap_or("");
    let consumed = !state.is_empty()
        && slack_store::consume_oauth_state(&db, state, &store::minutes_ago(STATE_MINUTES)).await?;
    if !consumed {
        return refuse(
            400,
            "InvalidState",
            "the state is unknown, used or older than 15 minutes; press Add to Slack again",
        );
    }
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
    let fixture = match fixtures::slack(env) {
        Ok(fixture) => fixture,
        Err(missing) => return missing.response(),
    };
    let redirect_uri = redirect_uri(request);
    let installed = slack::oauth_access(&OAuthCode {
        code,
        client_id: &fixture.client_id,
        client_secret: &fixture.client_secret,
        redirect_uri: &redirect_uri,
    })
    .await?;
    let installed = match installed {
        Ok(installed) => installed,
        Err(error) => return slack_refusal(error),
    };
    slack_store::upsert_workspace(
        &db,
        &Installed {
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
        (Method::Get, ["install"]) => install(env, request).await,
        (Method::Get, ["oauth", "callback"]) => callback(env, request).await,
        (Method::Get, ["workspaces"]) => {
            Response::from_json(&slack_store::list_workspaces(&db).await?)
        }
        (Method::Delete, ["workspaces", workspace_id]) => delete_workspace(&db, workspace_id).await,
        _ => no_route(request),
    }
}
