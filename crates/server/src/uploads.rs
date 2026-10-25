use serde::{Deserialize, Serialize};
use serde_json::Value;
use worker::*;

use crate::ingest::{self, Signed};
use crate::store::{self, STORED};
use crate::{refuse, sign};

const CONTENT_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const SIZE_MAX: u64 = 5 * 1024 * 1024;
const UPLOAD_SECONDS: i64 = 900;
const SIGNING_SECRET: &str = "UPLOAD_SIGNING_SECRET";
const IMMUTABLE: &str = "public, max-age=31536000, immutable";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Reserved {
    image_id: String,
    upload_url: String,
    expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Stored {
    image_id: String,
}

#[derive(Deserialize)]
struct UploadQuery {
    exp: Option<String>,
    sig: Option<String>,
}

fn invalid(message: &str) -> Result<Response> {
    refuse(400, "InvalidUpload", message)
}

fn signing_secret(env: &Env) -> Result<String> {
    let secret = env.secret(SIGNING_SECRET)?.to_string();
    if secret.is_empty() {
        return Err(Error::RustError(format!(
            "the Worker secret {SIGNING_SECRET} is empty"
        )));
    }
    Ok(secret)
}

fn now_seconds() -> i64 {
    (Date::now().as_millis() / 1000) as i64
}

fn upload_request(body: &[u8]) -> std::result::Result<(String, u64), String> {
    let Ok(request) = serde_json::from_slice::<Value>(body) else {
        return Err("the body must be a JSON object {contentType, size}".into());
    };
    let Some(content_type) = request.get("contentType").and_then(Value::as_str) else {
        return Err("contentType must be a string".into());
    };
    if !CONTENT_TYPES.contains(&content_type) {
        return Err(format!(
            "contentType must be one of {}, not {content_type:?}",
            CONTENT_TYPES.join(", ")
        ));
    }
    let Some(size) = request
        .get("size")
        .and_then(Value::as_u64)
        .filter(|size| (1..=SIZE_MAX).contains(size))
    else {
        return Err(format!(
            "size must be an integer from 1 to {SIZE_MAX} bytes"
        ));
    };
    Ok((content_type.to_string(), size))
}

fn iso(seconds: i64) -> String {
    String::from(
        js_sys::Date::new(&wasm_bindgen::JsValue::from_f64(seconds as f64 * 1000.0))
            .to_iso_string(),
    )
}

pub async fn reserve(mut req: Request, env: &Env, app_id: &str) -> Result<Response> {
    let db = env.d1("DB")?;
    let Signed { body, client_id } = match ingest::authenticate(&mut req, &db, app_id).await? {
        Ok(signed) => signed,
        Err(response) => return Ok(response),
    };
    let (content_type, size) = match upload_request(&body) {
        Ok(request) => request,
        Err(message) => return invalid(&message),
    };
    let secret = signing_secret(env)?;
    let image_id = store::reserve_image(&db, app_id, &client_id, &content_type, size).await?;
    let exp = now_seconds() + UPLOAD_SECONDS;
    let signature = sign::upload_signature(&secret, &image_id, exp)
        .ok_or_else(|| Error::RustError("the upload signing key does not load".into()))?;
    let url = req.url()?;
    let host = url
        .host_str()
        .ok_or_else(|| Error::RustError(format!("{url} has no host")))?;
    let reserved = Reserved {
        upload_url: format!("https://{host}/v1/uploads/{image_id}?exp={exp}&sig={signature}"),
        image_id,
        expires_at: iso(exp),
    };
    Ok(Response::from_json(&reserved)?.with_status(201))
}

fn with_cors(response: Response) -> Result<Response> {
    let headers = Headers::new();
    for (name, value) in response.headers().entries() {
        headers.append(&name, &value)?;
    }
    headers.set("Access-Control-Allow-Origin", "*")?;
    headers.set("Access-Control-Allow-Methods", "PUT")?;
    headers.set("Access-Control-Allow-Headers", "content-type")?;
    headers.set("Access-Control-Max-Age", "86400")?;
    Ok(response.with_headers(headers))
}

pub fn preflight() -> Result<Response> {
    with_cors(Response::empty()?.with_status(204))
}

pub async fn upload(req: Request, env: &Env, image_id: &str) -> Result<Response> {
    with_cors(store_upload(req, env, image_id).await?)
}

async fn store_upload(mut req: Request, env: &Env, image_id: &str) -> Result<Response> {
    let query: UploadQuery = req.query()?;
    let secret = signing_secret(env)?;
    let (Some(exp), Some(sig)) = (query.exp, query.sig) else {
        return refuse(401, "BadSignature", "the upload URL needs exp and sig");
    };
    if !sign::upload_signed(&secret, image_id, &exp, &sig) {
        return refuse(
            401,
            "BadSignature",
            "sig does not match; ask for a new upload URL",
        );
    }
    let Some(expires) = exp.parse::<i64>().ok() else {
        return refuse(401, "BadSignature", "exp must be Unix seconds");
    };
    if now_seconds() > expires {
        return refuse(
            410,
            "UploadExpired",
            "the upload URL expired; ask for a new one",
        );
    }
    let db = env.d1("DB")?;
    let Some(image) = store::get_image(&db, image_id).await? else {
        return refuse(404, "NotFound", &format!("no image with id {image_id}"));
    };
    if image.status == STORED {
        return refuse(
            409,
            "AlreadyStored",
            &format!("image {image_id} is already stored"),
        );
    }
    let content_type = req.headers().get("content-type")?.unwrap_or_default();
    if content_type != image.content_type {
        return refuse(
            415,
            "WrongContentType",
            &format!(
                "content-type must be {}, not {content_type:?}",
                image.content_type
            ),
        );
    }
    let too_large = || {
        refuse(
            413,
            "TooLarge",
            &format!("the reserved size is {} bytes", image.size),
        )
    };
    let declared = req
        .headers()
        .get("content-length")?
        .and_then(|length| length.parse::<u64>().ok());
    if declared.is_some_and(|length| length > image.size) {
        return too_large();
    }
    let bytes = req.bytes().await?;
    if bytes.len() as u64 > image.size {
        return too_large();
    }
    env.bucket("IMAGES")?
        .put(image_id, bytes)
        .http_metadata(HttpMetadata {
            content_type: Some(image.content_type.clone()),
            ..HttpMetadata::default()
        })
        .execute()
        .await?;
    store::set_image_stored(&db, image_id).await?;
    Response::from_json(&Stored {
        image_id: image_id.to_string(),
    })
}

pub async fn image(env: &Env, image_id: &str) -> Result<Response> {
    let missing = || refuse(404, "NotFound", &format!("no image with id {image_id}"));
    let db = env.d1("DB")?;
    let Some(image) = store::get_image(&db, image_id).await? else {
        return missing();
    };
    if image.status != STORED {
        return missing();
    }
    let Some(object) = env.bucket("IMAGES")?.get(image_id).execute().await? else {
        return missing();
    };
    let body = object
        .body()
        .ok_or_else(|| Error::RustError(format!("image {image_id} has no body in R2")))?
        .response_body()?;
    let headers = Headers::new();
    headers.set("content-type", &image.content_type)?;
    headers.set("cache-control", IMMUTABLE)?;
    Ok(Response::from_body(body)?.with_headers(headers))
}
