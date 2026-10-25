pub mod admin;
pub mod auth;
pub mod github;
pub mod random;
pub mod routes;
pub mod store;

use serde_json::json;
use worker::*;

const COMMIT_HEADER: &str = "x-bugstack-commit";
const COMMIT: &str = env!("BUGSTACK_COMMIT");

pub(crate) fn refuse(status: u16, reason: &str, message: &str) -> Result<Response> {
    Ok(Response::from_json(&json!({ "reason": reason, "message": message }))?.with_status(status))
}

fn stamp_commit(response: Response) -> Result<Response> {
    let headers = Headers::new();
    for (name, value) in response.headers().entries() {
        headers.append(&name, &value)?;
    }
    headers.set(COMMIT_HEADER, COMMIT)?;
    Ok(response.with_headers(headers))
}

#[event(fetch)]
async fn fetch(req: Request, env: Env, _ctx: Context) -> Result<Response> {
    stamp_commit(route(req, &env).await?)
}

async fn route(req: Request, env: &Env) -> Result<Response> {
    let url = req.url()?;
    if url.path().starts_with("/api/") {
        return admin::handle(req, env).await;
    }
    if req.method() == Method::Get && url.path() == "/v1/health" {
        return Response::from_json(&json!({ "commit": COMMIT }));
    }
    refuse(
        404,
        "NotFound",
        &format!("no route for {} {}", req.method(), url.path()),
    )
}

#[event(scheduled)]
async fn scheduled(_event: ScheduledEvent, _env: Env, _ctx: ScheduleContext) {}
