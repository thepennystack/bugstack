use serde::Serialize;
use serde_json::Value;
use worker::*;

use crate::sign::{self, Verdict};
use crate::store::{self, DeclaredImage, NewReport};
use crate::uploads::{self, CONTENT_TYPES, SIZE_MAX, Upload};
use crate::{deliver, refuse};

const MAX_BODY: usize = 60 * 1024;
const TITLE_MAX: usize = 200;
const IMAGES_MAX: usize = 10;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Accepted {
    report_id: String,
    uploads: Vec<Upload>,
}

struct Signed {
    pub body: Vec<u8>,
    pub client_id: String,
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

async fn authenticate(
    req: &mut Request,
    db: &D1Database,
    app_id: &str,
) -> Result<std::result::Result<Signed, Response>> {
    let body = req.bytes().await?;
    if body.len() > MAX_BODY {
        return refuse(
            413,
            "TooLarge",
            &format!(
                "the request is {} bytes; the limit is {MAX_BODY}",
                body.len()
            ),
        )
        .map(Err);
    }
    let headers = req.headers();
    let Some(client_id) = headers.get(sign::CLIENT_HEADER)? else {
        return refuse(401, MISSING.0, MISSING.1).map(Err);
    };
    let client = store::signing_client(db, &client_id).await?;
    let verdict = sign::verify(
        sign::secret_for(client.as_ref(), app_id),
        headers.get(sign::TIMESTAMP_HEADER)?.as_deref(),
        &body,
        headers.get(sign::SIGNATURE_HEADER)?.as_deref(),
        (Date::now().as_millis() / 1000) as i64,
    );
    if let Some((reason, message)) = rejection(verdict) {
        return refuse(401, reason, message).map(Err);
    }
    Ok(Ok(Signed { body, client_id }))
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

fn declared_image(image: &Value) -> std::result::Result<DeclaredImage, String> {
    let Some(content_type) = image.get("contentType").and_then(Value::as_str) else {
        return Err(format!(
            "each image needs a contentType string, not {image}"
        ));
    };
    if !CONTENT_TYPES.contains(&content_type) {
        return Err(format!(
            "image contentType must be one of {}, not {content_type:?}",
            CONTENT_TYPES.join(", ")
        ));
    }
    let Some(size) = image
        .get("size")
        .and_then(Value::as_u64)
        .filter(|size| (1..=SIZE_MAX).contains(size))
    else {
        return Err(format!(
            "image size must be an integer from 1 to {SIZE_MAX} bytes, not {}",
            image.get("size").unwrap_or(&Value::Null)
        ));
    };
    Ok(DeclaredImage {
        content_type: content_type.to_string(),
        size,
    })
}

fn declared_images(report: &Value) -> std::result::Result<Vec<DeclaredImage>, String> {
    let Some(images) = report.get("images") else {
        return Ok(Vec::new());
    };
    let Some(images) = images.as_array() else {
        return Err("images must be an array of {contentType, size}".into());
    };
    if images.len() > IMAGES_MAX {
        return Err(format!(
            "images declares {} images; the limit is {IMAGES_MAX}",
            images.len()
        ));
    }
    images.iter().map(declared_image).collect()
}

pub async fn handle(mut req: Request, env: &Env, ctx: &Context, app_id: &str) -> Result<Response> {
    let db = env.d1("DB")?;
    let Signed { body, client_id } = match authenticate(&mut req, &db, app_id).await? {
        Ok(signed) => signed,
        Err(response) => return Ok(response),
    };
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
    let images = match declared_images(&report) {
        Ok(images) => images,
        Err(message) => return invalid(&message),
    };
    let url = req.url()?;
    let host = url
        .host_str()
        .ok_or_else(|| Error::RustError(format!("{url} has no host")))?;
    let inserted = store::insert_report(
        &db,
        &NewReport {
            app_id,
            client_id: &client_id,
            title: &title,
            payload: &payload,
            images: &images,
        },
    )
    .await?;
    let response = Response::from_json(&Accepted {
        report_id: inserted.report_id.clone(),
        uploads: uploads::upload_links(env, host, inserted.image_ids)?,
    })?
    .with_status(202);
    deliver::in_background(ctx, env, inserted.report_id);
    Ok(response)
}
