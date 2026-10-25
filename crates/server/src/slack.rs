use serde::Deserialize;
use serde_json::{Value, json};
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

type Outcome = std::result::Result<(), SlackError>;

pub fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

async fn call(method: &str, token: &str, body: &Value) -> Result<Outcome> {
    let headers = Headers::new();
    headers.set("Authorization", &format!("Bearer {token}"))?;
    headers.set("Content-Type", "application/json; charset=utf-8")?;
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_body(Some(JsValue::from_str(&body.to_string())));
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
        return Ok(Ok(()));
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

pub async fn auth_test(token: &str) -> Result<Outcome> {
    call("auth.test", token, &json!({})).await
}

pub async fn post_message(token: &str, channel: &str, text: &str) -> Result<Outcome> {
    call(
        "chat.postMessage",
        token,
        &json!({ "channel": channel, "text": text }),
    )
    .await
}
