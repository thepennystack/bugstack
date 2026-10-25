use serde::Serialize;
use serde_json::Value;
use worker::*;

use crate::admin::ApiRequest;
use crate::github::GitHubError;
use crate::org_store::{self, Membership};
use crate::store::{self, AppInput, Client, ClientRemoval};
use crate::{deliver, github_routes, org_routes, refuse, slack_routes, slack_store};

const NAME_MAX: usize = 80;
const DESCRIPTION_MAX: usize = 500;
const OWNER_MAX: usize = 39;
const REPO_MAX: usize = 100;
const CHANNEL_MAX: usize = 80;
pub(crate) const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppDetail {
    app: store::App,
    clients: Vec<Client>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CreatedClient {
    #[serde(flatten)]
    client: Client,
    secret: String,
}

pub(crate) type Checked<T> = std::result::Result<T, String>;

pub(crate) fn invalid(message: &str) -> Result<Response> {
    refuse(400, "Invalid", message)
}

pub(crate) fn not_found(what: &str, id: &str) -> Result<Response> {
    refuse(404, "NotFound", &format!("no {what} with id {id}"))
}

pub(crate) fn no_route(request: &ApiRequest) -> Result<Response> {
    refuse(
        404,
        "NotFound",
        &format!("no route for {} {}", request.method, request.path),
    )
}

pub(crate) fn text_field(body: &Value, field: &str, min: usize, max: usize) -> Checked<String> {
    let Some(value) = body.get(field).and_then(Value::as_str) else {
        return Err(format!("{field} must be a string"));
    };
    let value = value.trim();
    let len = value.chars().count();
    if len < min || len > max {
        return Err(format!(
            "{field} must be {min} to {max} characters after trimming, not {len}"
        ));
    }
    Ok(value.to_string())
}

fn valid_owner(owner: &str) -> bool {
    !owner.is_empty()
        && owner.len() <= OWNER_MAX
        && !owner.starts_with('-')
        && owner.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn valid_repo_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= REPO_MAX
        && name != "."
        && name != ".."
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

fn github_repo(body: &Value) -> Checked<String> {
    let Some(value) = body.get("githubRepo").and_then(Value::as_str) else {
        return Err("githubRepo must be a string".into());
    };
    let value = value.trim();
    let Some((owner, name)) = value.split_once('/') else {
        return Err(format!("githubRepo must be owner/name, not {value:?}"));
    };
    if !valid_owner(owner) || !valid_repo_name(name) {
        return Err(format!("githubRepo must be owner/name, not {value:?}"));
    }
    Ok(value.to_string())
}

fn installation_id(body: &Value) -> Checked<u64> {
    body.get("installationId")
        .and_then(Value::as_u64)
        .filter(|id| *id <= MAX_SAFE_INTEGER)
        .ok_or_else(|| "installationId must be a non-negative integer".into())
}

fn app_input(body: &Value) -> Checked<AppInput> {
    Ok(AppInput {
        name: text_field(body, "name", 1, NAME_MAX)?,
        description: text_field(body, "description", 0, DESCRIPTION_MAX)?,
        installation_id: installation_id(body)?,
        github_repo: github_repo(body)?,
    })
}

pub(crate) fn github_failure(error: GitHubError) -> Result<Response> {
    match error {
        GitHubError::KeyInvalid(message) => refuse(500, "KeyInvalid", &message),
        GitHubError::Answered {
            request,
            status: 404,
            excerpt,
        } => refuse(
            404,
            "NotFound",
            &format!("GitHub {request} answered 404 {excerpt}"),
        ),
        GitHubError::Answered {
            request,
            status,
            excerpt,
        } => refuse(
            502,
            "GitHubFailed",
            &format!("GitHub {request} answered {status} {excerpt}"),
        ),
        GitHubError::Failed(message) => refuse(502, "GitHubFailed", &message),
    }
}

pub(crate) fn created<T: Serialize>(value: &T) -> Result<Response> {
    Ok(Response::from_json(value)?.with_status(201))
}

async fn checked_input(
    db: &D1Database,
    org_id: &str,
    body: &Value,
) -> Result<std::result::Result<AppInput, Response>> {
    let input = match app_input(body) {
        Ok(input) => input,
        Err(message) => return Ok(Err(invalid(&message)?)),
    };
    if input.installation_id != 0
        && !org_store::has_installation(db, org_id, input.installation_id).await?
    {
        return Ok(Err(invalid(&format!(
            "installationId {} is not an installation of this organisation",
            input.installation_id
        ))?));
    }
    Ok(Ok(input))
}

async fn create_app(db: &D1Database, org_id: &str, body: &Value) -> Result<Response> {
    let input = match checked_input(db, org_id, body).await? {
        Ok(input) => input,
        Err(response) => return Ok(response),
    };
    created(&store::create_app(db, org_id, &input).await?)
}

async fn get_app(db: &D1Database, org_id: &str, app_id: &str) -> Result<Response> {
    let Some(app) = store::get_app(db, org_id, app_id).await? else {
        return not_found("app", app_id);
    };
    let clients = store::list_clients(db, app_id).await?;
    Response::from_json(&AppDetail { app, clients })
}

async fn put_app(db: &D1Database, org_id: &str, app_id: &str, body: &Value) -> Result<Response> {
    if store::get_app(db, org_id, app_id).await?.is_none() {
        return not_found("app", app_id);
    }
    let input = match checked_input(db, org_id, body).await? {
        Ok(input) => input,
        Err(response) => return Ok(response),
    };
    match store::update_app(db, org_id, app_id, &input).await? {
        Some(app) => Response::from_json(&app),
        None => not_found("app", app_id),
    }
}

async fn create_client(
    db: &D1Database,
    org_id: &str,
    app_id: &str,
    body: &Value,
) -> Result<Response> {
    let name = match text_field(body, "name", 1, NAME_MAX) {
        Ok(name) => name,
        Err(message) => return invalid(&message),
    };
    if store::get_app(db, org_id, app_id).await?.is_none() {
        return not_found("app", app_id);
    }
    let secret = crate::random::secret()?;
    let client = store::create_client(db, org_id, app_id, &name, &secret).await?;
    created(&CreatedClient { client, secret })
}

async fn revoke_client(db: &D1Database, org_id: &str, client_id: &str) -> Result<Response> {
    match store::revoke_client(db, org_id, client_id).await? {
        Some(client) => Response::from_json(&client),
        None => not_found("client", client_id),
    }
}

async fn delete_client(db: &D1Database, org_id: &str, client_id: &str) -> Result<Response> {
    match store::delete_client(db, org_id, client_id).await? {
        ClientRemoval::Removed => no_content(),
        ClientRemoval::Missing => not_found("client", client_id),
        ClientRemoval::NotRevoked(status) => refuse(
            409,
            "NotRevoked",
            &format!("client {client_id} is {status}; revoke it before deleting it"),
        ),
    }
}

const R2_DELETE_MAX: usize = 1000;

async fn delete_app(env: &Env, org_id: &str, app_id: &str) -> Result<Response> {
    let Some(image_ids) = store::delete_app(&env.d1("DB")?, org_id, app_id).await? else {
        return not_found("app", app_id);
    };
    let bucket = env.bucket("IMAGES")?;
    for chunk in image_ids.chunks(R2_DELETE_MAX) {
        if let Err(error) = bucket.delete_multiple(chunk.to_vec()).await {
            console_error!(
                "deleting {} image(s) of app {app_id} from R2 failed: {error}",
                chunk.len()
            );
        }
    }
    no_content()
}

async fn list_reports(db: &D1Database, org_id: &str, app_id: &str) -> Result<Response> {
    if store::get_app(db, org_id, app_id).await?.is_none() {
        return not_found("app", app_id);
    }
    Response::from_json(&store::list_reports(db, app_id).await?)
}

async fn retry(env: &Env, ctx: &Context, org_id: &str, report_id: &str) -> Result<Response> {
    let db = env.d1("DB")?;
    if !store::reset_failed(&db, org_id, report_id).await? {
        return match store::get_report(&db, org_id, report_id).await? {
            Some(report) => refuse(
                409,
                "NotFailed",
                &format!("report {report_id} is {}, not Failed", report.status),
            ),
            None => not_found("report", report_id),
        };
    }
    let report = store::get_report(&db, org_id, report_id)
        .await?
        .ok_or_else(|| {
            Error::RustError(format!("report {report_id} vanished after the retry reset"))
        })?;
    deliver::in_background(ctx, env, report_id.to_string());
    Response::from_json(&report)
}

pub(crate) fn no_content() -> Result<Response> {
    Ok(Response::empty()?.with_status(204))
}

async fn put_app_slack(
    db: &D1Database,
    org_id: &str,
    app_id: &str,
    body: &Value,
) -> Result<Response> {
    let checked = text_field(body, "workspaceId", 1, NAME_MAX).and_then(|workspace_id| {
        text_field(body, "channel", 1, CHANNEL_MAX).map(|channel| (workspace_id, channel))
    });
    let (workspace_id, channel) = match checked {
        Ok(checked) => checked,
        Err(message) => return invalid(&message),
    };
    if store::get_app(db, org_id, app_id).await?.is_none() {
        return not_found("app", app_id);
    }
    if slack_store::get_workspace(db, org_id, &workspace_id)
        .await?
        .is_none()
    {
        return not_found("Slack workspace", &workspace_id);
    }
    store::set_app_slack(db, app_id, &workspace_id, &channel).await?;
    no_content()
}

async fn delete_app_slack(db: &D1Database, org_id: &str, app_id: &str) -> Result<Response> {
    if store::get_app(db, org_id, app_id).await?.is_none() {
        return not_found("app", app_id);
    }
    store::delete_app_slack(db, app_id).await?;
    no_content()
}

pub(crate) fn segments(path: &str) -> Vec<&str> {
    path.trim_start_matches("/api/")
        .trim_end_matches('/')
        .split('/')
        .collect()
}

async fn scoped(
    request: &ApiRequest,
    env: &Env,
    ctx: &Context,
    org: &Membership,
    rest: &[&str],
) -> Result<Response> {
    let db = env.d1("DB")?;
    let org_id = org.org_id.as_str();
    let body = &request.body;
    match (&request.method, rest) {
        (_, ["members", ..]) => org_routes::members(request, &db, org, &rest[1..]).await,
        (_, ["github", ..]) => github_routes::route(request, env, org, &rest[1..]).await,
        (_, ["slack", ..]) => slack_routes::route(request, env, org, &rest[1..]).await,
        (Method::Get, ["apps"]) => Response::from_json(&store::list_apps(&db, org_id).await?),
        (Method::Post, ["apps"]) => create_app(&db, org_id, body).await,
        (Method::Get, ["apps", app_id]) => get_app(&db, org_id, app_id).await,
        (Method::Put, ["apps", app_id]) => put_app(&db, org_id, app_id, body).await,
        (Method::Delete, ["apps", app_id]) => delete_app(env, org_id, app_id).await,
        (Method::Get, ["apps", app_id, "reports"]) => list_reports(&db, org_id, app_id).await,
        (Method::Post, ["apps", app_id, "clients"]) => {
            create_client(&db, org_id, app_id, body).await
        }
        (Method::Put, ["apps", app_id, "slack"]) => put_app_slack(&db, org_id, app_id, body).await,
        (Method::Delete, ["apps", app_id, "slack"]) => delete_app_slack(&db, org_id, app_id).await,
        (Method::Delete, ["clients", client_id]) => delete_client(&db, org_id, client_id).await,
        (Method::Post, ["clients", client_id, "revoke"]) => {
            revoke_client(&db, org_id, client_id).await
        }
        (Method::Post, ["reports", report_id, "retry"]) => retry(env, ctx, org_id, report_id).await,
        _ => no_route(request),
    }
}

pub async fn route(request: ApiRequest, env: &Env, ctx: &Context) -> Result<Response> {
    let segments = segments(&request.path);
    match (&request.method, segments.as_slice()) {
        (Method::Get, ["me"]) => org_routes::me(&request),
        (Method::Post, ["orgs"]) => org_routes::create_org(&request, env).await,
        (Method::Get, ["github", "setup"]) => github_routes::setup(&request, env).await,
        (Method::Get, ["slack", "oauth", "callback"]) => {
            slack_routes::callback(&request, env).await
        }
        (_, ["orgs", org_id, rest @ ..]) => {
            let Some(org) = request
                .memberships
                .iter()
                .find(|membership| membership.org_id == *org_id)
            else {
                return org_routes::not_a_member(org_id);
            };
            scoped(&request, env, ctx, org, rest).await
        }
        _ => no_route(&request),
    }
}
