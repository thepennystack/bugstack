use serde::Deserialize;
use serde_json::json;
use wasm_bindgen::JsValue;
use worker::*;

const API: &str = "https://slack.com/api";
const BODY_EXCERPT: usize = 500;

pub enum SlackError {
    Refused {
        status: u16,
        error: String,
        excerpt: String,
    },
    Failed(String),
}

impl SlackError {
    pub fn failure(&self) -> String {
        match self {
            SlackError::Refused {
                status, excerpt, ..
            } => format!("{status} {excerpt}"),
            SlackError::Failed(message) => message.clone(),
        }
    }
}

#[derive(Deserialize)]
struct Answer {
    ok: bool,
    error: Option<String>,
}

#[derive(Deserialize)]
pub struct Team {
    pub id: String,
    pub name: String,
}

#[derive(Deserialize)]
pub struct Installed {
    pub access_token: String,
    pub team: Team,
}

pub struct OAuthCode<'a> {
    pub code: &'a str,
    pub client_id: &'a str,
    pub client_secret: &'a str,
    pub redirect_uri: &'a str,
}

type Outcome<T> = std::result::Result<T, SlackError>;

pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(key, value)| {
            format!(
                "{}={}",
                js_sys::encode_uri_component(key),
                js_sys::encode_uri_component(value)
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}

async fn call(method: &str, headers: Headers, body: String) -> Result<Outcome<String>> {
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_body(Some(JsValue::from_str(&body)));
    let request = Request::new_with_init(&format!("{API}/{method}"), &init)?;
    let mut response = match Fetch::Request(request).send().await {
        Ok(response) => response,
        Err(error) => {
            return Ok(Err(SlackError::Failed(format!(
                "Slack {method} did not answer: {error}"
            ))));
        }
    };
    let status = response.status_code();
    let text = match response.text().await {
        Ok(text) => text,
        Err(error) => {
            return Ok(Err(SlackError::Failed(format!(
                "Slack {method} broke off its answer: {error}"
            ))));
        }
    };
    let excerpt: String = text.chars().take(BODY_EXCERPT).collect();
    let answer: Option<Answer> = serde_json::from_str(&text).ok();
    if (200..300).contains(&status)
        && let Some(Answer { ok: true, .. }) = answer
    {
        return Ok(Ok(text));
    }
    let error = answer
        .and_then(|answer| answer.error)
        .unwrap_or_else(|| format!("HTTP {status}"));
    Ok(Err(SlackError::Refused {
        status,
        error,
        excerpt,
    }))
}

pub async fn post_message(token: &str, channel: &str, text: &str) -> Result<Outcome<()>> {
    let headers = Headers::new();
    headers.set("Authorization", &format!("Bearer {token}"))?;
    headers.set("Content-Type", "application/json; charset=utf-8")?;
    let body = json!({ "channel": channel, "text": text }).to_string();
    Ok(call("chat.postMessage", headers, body).await?.map(|_| ()))
}

pub async fn oauth_access(code: &OAuthCode<'_>) -> Result<Outcome<Installed>> {
    let headers = Headers::new();
    headers.set("Content-Type", "application/x-www-form-urlencoded")?;
    let body = form(&[
        ("code", code.code),
        ("client_id", code.client_id),
        ("client_secret", code.client_secret),
        ("redirect_uri", code.redirect_uri),
    ]);
    let text = match call("oauth.v2.access", headers, body).await? {
        Ok(text) => text,
        Err(error) => return Ok(Err(error)),
    };
    Ok(serde_json::from_str::<Installed>(&text).map_err(|error| {
        SlackError::Failed(format!(
            "Slack oauth.v2.access answered ok without a bot token and team: {error}"
        ))
    }))
}
