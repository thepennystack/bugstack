use serde::Serialize;
use worker::*;

use crate::admin::ApiRequest;
use crate::fixtures;
use crate::github::{self, GitHubError};
use crate::org_routes::not_a_member;
use crate::org_store::{self, Membership};
use crate::refuse;
use crate::routes::{MAX_SAFE_INTEGER, created, github_failure, invalid, no_content, no_route};
use crate::slack_routes::redirect;
use crate::store::{self, Removal};

const INSTALL_BASE: &str = "https://github.com/apps";
const STATE_MINUTES: u32 = 15;

#[derive(Serialize)]
struct InstallUrl {
    url: String,
}

fn parse_installation_id(id: &str) -> Option<u64> {
    id.parse::<u64>()
        .ok()
        .filter(|id| *id > 0 && *id <= MAX_SAFE_INTEGER)
}

fn not_installed(id: &str) -> Result<Response> {
    refuse(
        404,
        "NotFound",
        &format!("no GitHub installation with id {id} in this organisation"),
    )
}

async fn install(request: &ApiRequest, env: &Env, org: &Membership) -> Result<Response> {
    let slug = match fixtures::github_slug(env) {
        Ok(slug) => slug,
        Err(missing) => return missing.response(),
    };
    let state = hex::encode(crate::random::bytes(16)?);
    org_store::issue_install_state(
        &env.d1("DB")?,
        &state,
        &org.org_id,
        &request.identity,
        &store::minutes_ago(STATE_MINUTES),
    )
    .await?;
    let url = Url::parse_with_params(
        &format!(
            "{INSTALL_BASE}/{}/installations/new",
            js_sys::encode_uri_component(&slug)
        ),
        &[("state", state.as_str())],
    )?;
    created(&InstallUrl {
        url: url.to_string(),
    })
}

pub async fn setup(request: &ApiRequest, env: &Env) -> Result<Response> {
    let db = env.d1("DB")?;
    let state = request.param("state").unwrap_or("");
    let org_id = match state {
        "" => None,
        state => {
            org_store::consume_install_state(&db, state, &store::minutes_ago(STATE_MINUTES)).await?
        }
    };
    let Some(org_id) = org_id else {
        return refuse(
            400,
            "InvalidState",
            "the state is unknown, used or older than 15 minutes; press Install on GitHub again",
        );
    };
    if !request
        .memberships
        .iter()
        .any(|membership| membership.org_id == org_id)
    {
        return not_a_member(&org_id);
    }
    let raw_id = request.param("installation_id").unwrap_or("");
    let Some(installation_id) = parse_installation_id(raw_id) else {
        return invalid(&format!(
            "installation_id must be a GitHub installation id, not {raw_id:?}"
        ));
    };
    let fixture = match fixtures::github(env) {
        Ok(fixture) => fixture,
        Err(missing) => return missing.response(),
    };
    let installation = match github::installation(&fixture.credentials(), installation_id).await? {
        Ok(installation) => installation,
        Err(GitHubError::Answered { status: 404, .. }) => {
            return refuse(
                400,
                "UnknownInstallation",
                &format!("GitHub knows no installation {installation_id} of this app"),
            );
        }
        Err(error) => return github_failure(error),
    };
    if !org_store::bind_installation(&db, &org_id, installation_id, &installation.account).await? {
        return refuse(
            409,
            "InstallationClaimed",
            &format!(
                "GitHub installation {installation_id} on {} belongs to another organisation",
                installation.account
            ),
        );
    }
    redirect(
        303,
        &format!(
            "/orgs/{org_id}/github?installed={}",
            js_sys::encode_uri_component(&installation.account)
        ),
    )
}

async fn repos(env: &Env, org: &Membership, id: &str) -> Result<Response> {
    let Some(installation_id) = parse_installation_id(id) else {
        return not_installed(id);
    };
    if !org_store::has_installation(&env.d1("DB")?, &org.org_id, installation_id).await? {
        return not_installed(id);
    }
    let fixture = match fixtures::github(env) {
        Ok(fixture) => fixture,
        Err(missing) => return missing.response(),
    };
    match github::repos(&fixture.credentials(), installation_id).await? {
        Ok(all) => Response::from_json(&all),
        Err(error) => github_failure(error),
    }
}

async fn delete_installation(env: &Env, org: &Membership, id: &str) -> Result<Response> {
    let Some(installation_id) = parse_installation_id(id) else {
        return not_installed(id);
    };
    match org_store::delete_installation(&env.d1("DB")?, &org.org_id, installation_id).await? {
        Removal::Removed => no_content(),
        Removal::Missing => not_installed(id),
        Removal::InUse(count) => refuse(
            409,
            "InUse",
            &format!("{count} app(s) file through this installation; pick another one first"),
        ),
    }
}

pub async fn route(
    request: &ApiRequest,
    env: &Env,
    org: &Membership,
    rest: &[&str],
) -> Result<Response> {
    match (&request.method, rest) {
        (Method::Post, ["install"]) => install(request, env, org).await,
        (Method::Get, ["installations"]) => {
            Response::from_json(&org_store::list_installations(&env.d1("DB")?, &org.org_id).await?)
        }
        (Method::Get, ["installations", id, "repos"]) => repos(env, org, id).await,
        (Method::Delete, ["installations", id]) => delete_installation(env, org, id).await,
        _ => no_route(request),
    }
}
