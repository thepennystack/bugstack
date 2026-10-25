use serde::Serialize;
use worker::*;

use crate::admin::ApiRequest;
use crate::org_store::{self, Membership, OWNER};
use crate::refuse;
use crate::routes::{created, invalid, no_content, no_route, not_found, text_field};

const ORG_NAME_MAX: usize = 80;
const EMAIL_MAX: usize = 254;
const MEMBER: &str = "Member";

#[derive(Serialize)]
struct Me<'a> {
    identity: &'a str,
    orgs: &'a [Membership],
}

pub fn not_a_member(org_id: &str) -> Result<Response> {
    refuse(
        403,
        "NotAMember",
        &format!("you are not a member of organisation {org_id}"),
    )
}

pub fn not_an_owner(org: &Membership) -> Result<Response> {
    refuse(
        403,
        "NotAnOwner",
        &format!("only an Owner of {} can do this", org.name),
    )
}

pub fn me(request: &ApiRequest) -> Result<Response> {
    Response::from_json(&Me {
        identity: &request.identity,
        orgs: &request.memberships,
    })
}

pub async fn create_org(request: &ApiRequest, env: &Env) -> Result<Response> {
    let name = match text_field(&request.body, "name", 1, ORG_NAME_MAX) {
        Ok(name) => name,
        Err(message) => return invalid(&message),
    };
    created(&org_store::create_org(&env.d1("DB")?, &name, &request.identity).await?)
}

fn email(request: &ApiRequest) -> std::result::Result<String, String> {
    let email = text_field(&request.body, "email", 3, EMAIL_MAX)?.to_lowercase();
    let valid = email
        .split_once('@')
        .is_some_and(|(local, domain)| !local.is_empty() && domain.contains('.'))
        && !email.chars().any(char::is_whitespace);
    if !valid {
        return Err(format!("email must be an email address, not {email:?}"));
    }
    Ok(email)
}

fn role(request: &ApiRequest) -> std::result::Result<&str, String> {
    match request.body.get("role").and_then(|role| role.as_str()) {
        Some(OWNER) => Ok(OWNER),
        Some(MEMBER) => Ok(MEMBER),
        other => Err(format!("role must be Owner or Member, not {other:?}")),
    }
}

async fn add_member(request: &ApiRequest, db: &D1Database, org: &Membership) -> Result<Response> {
    if !org.is_owner() {
        return not_an_owner(org);
    }
    let checked = email(request).and_then(|email| role(request).map(|role| (email, role)));
    let (email, role) = match checked {
        Ok(checked) => checked,
        Err(message) => return invalid(&message),
    };
    match org_store::add_member(db, &org.org_id, &email, role).await? {
        Some(member) => created(&member),
        None => refuse(
            409,
            "AlreadyMember",
            &format!("{email} is already a member of {}", org.name),
        ),
    }
}

async fn remove_member(
    request: &ApiRequest,
    db: &D1Database,
    org: &Membership,
    member_id: &str,
) -> Result<Response> {
    let Some(member) = org_store::get_member(db, &org.org_id, member_id).await? else {
        return not_found("member", member_id);
    };
    if !org.is_owner() && member.identity != request.identity {
        return not_an_owner(org);
    }
    if !org_store::remove_member(db, &org.org_id, member_id).await? {
        return refuse(
            409,
            "LastOwner",
            &format!(
                "{} is the last Owner of {}; make another member an Owner first",
                member.identity, org.name
            ),
        );
    }
    no_content()
}

pub async fn members(
    request: &ApiRequest,
    db: &D1Database,
    org: &Membership,
    rest: &[&str],
) -> Result<Response> {
    match (&request.method, rest) {
        (Method::Get, []) => Response::from_json(&org_store::list_members(db, &org.org_id).await?),
        (Method::Post, []) => add_member(request, db, org).await,
        (Method::Delete, [member_id]) => remove_member(request, db, org, member_id).await,
        _ => no_route(request),
    }
}
