use serde::Serialize;
use serde_json::Value;
use worker::*;

use crate::refuse;
use crate::sign::{self, Verdict};
use crate::store::{self, NewReport};

const MAX_BODY: usize = 60 * 1024;
const TITLE_MAX: usize = 200;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Accepted {
    report_id: String,
}

const MISSING: (&str, &str) = (
    "MissingSignature",
    "send X-Bugstack-Client, X-Bugstack-Timestamp and X-Bugstack-Signature",
);

fn rejection(verdict: Verdict) -> Option<(&'static str, &'static str)> {
    match verdict {
        Verdict::Valid => None,
        Verdict::MissingSignature => Some(MISSING),
        Verdict::StaleTimestamp => Some((
            "StaleTimestamp",
            "X-Bugstack-Timestamp must be Unix seconds within 300 s of the server clock",
        )),
        Verdict::UnknownClient => Some((
            "UnknownClient",
            "X-Bugstack-Client is not an active client of this app",
        )),
        Verdict::BadSignature => Some((
            "BadSignature",
            "X-Bugstack-Signature must be the hex HMAC-SHA256 of \"{timestamp}.{body}\" keyed with the client secret",
        )),
    }
}

fn invalid(message: &str) -> Result<Response> {
    refuse(400, "InvalidReport", message)
}

fn title(report: &Value) -> std::result::Result<String, String> {
    let Some(object) = report.as_object() else {
        return Err("the body must be a JSON object".into());
    };
    let Some(title) = object.get("title").and_then(Value::as_str) else {
        return Err("title must be a string".into());
    };
    let title = title.trim();
    let len = title.chars().count();
    if len == 0 || len > TITLE_MAX {
        return Err(format!(
            "title must be 1 to {TITLE_MAX} characters after trimming, not {len}"
        ));
    }
    Ok(title.to_string())
}

pub async fn handle(mut req: Request, env: &Env, app_id: &str) -> Result<Response> {
    let body = req.bytes().await?;
    if body.len() > MAX_BODY {
        return refuse(
            413,
            "TooLarge",
            &format!(
                "the report is {} bytes; the limit is {MAX_BODY}",
                body.len()
            ),
        );
    }
    let headers = req.headers();
    let Some(client_id) = headers.get(sign::CLIENT_HEADER)? else {
        return refuse(401, MISSING.0, MISSING.1);
    };
    let db = env.d1("DB")?;
    let client = store::signing_client(&db, &client_id).await?;
    let verdict = sign::verify(
        sign::secret_for(client.as_ref(), app_id),
        headers.get(sign::TIMESTAMP_HEADER)?.as_deref(),
        &body,
        headers.get(sign::SIGNATURE_HEADER)?.as_deref(),
        (Date::now().as_millis() / 1000) as i64,
    );
    if let Some((reason, message)) = rejection(verdict) {
        return refuse(401, reason, message);
    }
    let Ok(payload) = String::from_utf8(body) else {
        return invalid("the body must be UTF-8 JSON");
    };
    let report: Value = match serde_json::from_str(&payload) {
        Ok(report) => report,
        Err(error) => return invalid(&format!("the body is not valid JSON: {error}")),
    };
    let title = match title(&report) {
        Ok(title) => title,
        Err(message) => return invalid(&message),
    };
    let report_id = store::insert_report(
        &db,
        &NewReport {
            app_id,
            client_id: &client_id,
            title: &title,
            payload: &payload,
        },
    )
    .await?;
    Ok(Response::from_json(&Accepted { report_id })?.with_status(202))
}
