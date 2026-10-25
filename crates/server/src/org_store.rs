use serde::{Deserialize, Serialize};
use wasm_bindgen::JsValue;
use worker::{D1Database, Result};

use crate::random;
use crate::store::{Removal, now};

pub const OWNER: &str = "Owner";

fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}

fn number(value: u64) -> JsValue {
    JsValue::from_f64(value as f64)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Membership {
    #[serde(alias = "org_id")]
    pub org_id: String,
    pub name: String,
    pub role: String,
}

impl Membership {
    pub fn is_owner(&self) -> bool {
        self.role == OWNER
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    #[serde(alias = "member_id")]
    pub member_id: String,
    pub identity: String,
    pub role: String,
    #[serde(alias = "created_at")]
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubInstallation {
    #[serde(alias = "installation_id")]
    pub installation_id: u64,
    pub account: String,
}

#[derive(Deserialize)]
struct Count {
    count: u32,
}

#[derive(Deserialize)]
struct MemberId {
    #[serde(rename = "member_id")]
    _member_id: String,
}

#[derive(Deserialize)]
struct OrgId {
    org_id: String,
}

pub async fn memberships(db: &D1Database, identity: &str) -> Result<Vec<Membership>> {
    db.prepare(
        "SELECT o.org_id, o.name, m.role FROM member m JOIN org o ON o.org_id = m.org_id \
         WHERE m.identity = ?1 ORDER BY m.created_at DESC, m.member_id DESC",
    )
    .bind(&[text(identity)])?
    .all()
    .await?
    .results()
}

pub async fn create_org(db: &D1Database, name: &str, identity: &str) -> Result<Membership> {
    let org_id = random::id()?;
    let created_at = now();
    db.batch(vec![
        db.prepare("INSERT INTO org (org_id, name, created_at) VALUES (?1, ?2, ?3)")
            .bind(&[text(&org_id), text(name), text(&created_at)])?,
        db.prepare(
            "INSERT INTO member (member_id, org_id, identity, role, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&[
            text(&random::id()?),
            text(&org_id),
            text(identity),
            text(OWNER),
            text(&created_at),
        ])?,
    ])
    .await?;
    Ok(Membership {
        org_id,
        name: name.to_string(),
        role: OWNER.into(),
    })
}

const MEMBER_SELECT: &str = "SELECT member_id, identity, role, created_at FROM member";

pub async fn list_members(db: &D1Database, org_id: &str) -> Result<Vec<Member>> {
    db.prepare(format!(
        "{MEMBER_SELECT} WHERE org_id = ?1 ORDER BY created_at, member_id"
    ))
    .bind(&[text(org_id)])?
    .all()
    .await?
    .results()
}

pub async fn get_member(db: &D1Database, org_id: &str, member_id: &str) -> Result<Option<Member>> {
    db.prepare(format!(
        "{MEMBER_SELECT} WHERE org_id = ?1 AND member_id = ?2"
    ))
    .bind(&[text(org_id), text(member_id)])?
    .first(None)
    .await
}

pub async fn add_member(
    db: &D1Database,
    org_id: &str,
    identity: &str,
    role: &str,
) -> Result<Option<Member>> {
    db.prepare(
        "INSERT INTO member (member_id, org_id, identity, role, created_at) \
         VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (org_id, identity) DO NOTHING \
         RETURNING member_id, identity, role, created_at",
    )
    .bind(&[
        text(&random::id()?),
        text(org_id),
        text(identity),
        text(role),
        text(&now()),
    ])?
    .first(None)
    .await
}

pub async fn remove_member(db: &D1Database, org_id: &str, member_id: &str) -> Result<bool> {
    let removed: Option<MemberId> = db
        .prepare(
            "DELETE FROM member WHERE org_id = ?1 AND member_id = ?2 AND (role <> 'Owner' OR \
             (SELECT COUNT(*) FROM member WHERE org_id = ?1 AND role = 'Owner') > 1) \
             RETURNING member_id",
        )
        .bind(&[text(org_id), text(member_id)])?
        .first(None)
        .await?;
    Ok(removed.is_some())
}

pub async fn issue_install_state(
    db: &D1Database,
    state: &str,
    org_id: &str,
    identity: &str,
    expired: &str,
) -> Result<()> {
    db.batch(vec![
        db.prepare("DELETE FROM github_install_state WHERE created_at < ?1")
            .bind(&[text(expired)])?,
        db.prepare(
            "INSERT INTO github_install_state (state, org_id, identity, created_at) \
             VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(&[text(state), text(org_id), text(identity), text(&now())])?,
    ])
    .await?;
    Ok(())
}

#[derive(Deserialize)]
struct StateRow {
    org_id: String,
    created_at: String,
}

pub async fn consume_install_state(
    db: &D1Database,
    state: &str,
    expired: &str,
) -> Result<Option<String>> {
    let consumed: Option<StateRow> = db
        .prepare("DELETE FROM github_install_state WHERE state = ?1 RETURNING org_id, created_at")
        .bind(&[text(state)])?
        .first(None)
        .await?;
    Ok(consumed
        .filter(|row| row.created_at.as_str() >= expired)
        .map(|row| row.org_id))
}

pub async fn bind_installation(
    db: &D1Database,
    org_id: &str,
    installation_id: u64,
    account: &str,
) -> Result<bool> {
    let bound: Option<OrgId> = db
        .prepare(
            "INSERT INTO github_installation (installation_id, org_id, account, created_at) \
             VALUES (?1, ?2, ?3, ?4) ON CONFLICT (installation_id) DO UPDATE SET \
             account = excluded.account WHERE github_installation.org_id = excluded.org_id \
             RETURNING org_id",
        )
        .bind(&[
            number(installation_id),
            text(org_id),
            text(account),
            text(&now()),
        ])?
        .first(None)
        .await?;
    Ok(bound.is_some_and(|row| row.org_id == org_id))
}

pub async fn list_installations(db: &D1Database, org_id: &str) -> Result<Vec<GitHubInstallation>> {
    db.prepare(
        "SELECT installation_id, account FROM github_installation WHERE org_id = ?1 \
         ORDER BY account, installation_id",
    )
    .bind(&[text(org_id)])?
    .all()
    .await?
    .results()
}

pub async fn has_installation(db: &D1Database, org_id: &str, installation_id: u64) -> Result<bool> {
    let found: Option<Count> = db
        .prepare(
            "SELECT COUNT(*) AS count FROM github_installation \
             WHERE org_id = ?1 AND installation_id = ?2",
        )
        .bind(&[text(org_id), number(installation_id)])?
        .first(None)
        .await?;
    Ok(found.is_some_and(|row| row.count > 0))
}

pub async fn delete_installation(
    db: &D1Database,
    org_id: &str,
    installation_id: u64,
) -> Result<Removal> {
    if !has_installation(db, org_id, installation_id).await? {
        return Ok(Removal::Missing);
    }
    let used: Option<Count> = db
        .prepare("SELECT COUNT(*) AS count FROM app WHERE github_installation_id = ?1")
        .bind(&[number(installation_id)])?
        .first(None)
        .await?;
    let count = used.map_or(0, |used| used.count);
    if count > 0 {
        return Ok(Removal::InUse(count));
    }
    db.prepare("DELETE FROM github_installation WHERE org_id = ?1 AND installation_id = ?2")
        .bind(&[text(org_id), number(installation_id)])?
        .run()
        .await?;
    Ok(Removal::Removed)
}
