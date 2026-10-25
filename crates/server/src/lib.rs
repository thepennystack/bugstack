pub mod admin;
pub mod auth;
pub mod deliver;
pub mod github;
pub mod ingest;
pub mod random;
pub mod routes;
pub mod sign;
pub mod slack;
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
async fn fetch(req: Request, env: Env, ctx: Context) -> Result<Response> {
    stamp_commit(route(req, &env, &ctx).await?)
}

fn report_app(path: &str) -> Option<&str> {
    path.strip_prefix("/v1/apps/")?
        .strip_suffix("/reports")
        .filter(|app_id| !app_id.is_empty() && !app_id.contains('/'))
}

async fn route(req: Request, env: &Env, ctx: &Context) -> Result<Response> {
    let url = req.url()?;
    if url.path().starts_with("/api/") {
        return admin::handle(req, env, ctx).await;
    }
    if req.method() == Method::Post
        && let Some(app_id) = report_app(url.path())
    {
        let app_id = app_id.to_string();
        return ingest::handle(req, env, ctx, &app_id).await;
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
async fn scheduled(_event: ScheduledEvent, env: Env, _ctx: ScheduleContext) {
    if let Err(error) = deliver::sweep(&env).await {
        console_error!("the delivery sweep failed: {error}");
    }
}
