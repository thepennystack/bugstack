use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use js_sys::futures::JsFuture;
use js_sys::{Array, Object, Reflect, Uint8Array};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use wasm_bindgen::{JsCast, JsValue};
use worker::*;

const API: &str = "https://api.github.com";
const APP_ID: &str = "GITHUB_APP_ID";
const PRIVATE_KEY: &str = "GITHUB_APP_PRIVATE_KEY";
const ALGORITHM: &str = "RSASSA-PKCS1-v1_5";
const BODY_EXCERPT: usize = 500;

pub enum GitHubError {
    SecretMissing(&'static str),
    SecretInvalid(String),
    NotFound(String),
    Failed(String),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Installation {
    pub installation_id: u64,
    pub account: String,
}

#[derive(Deserialize)]
struct RawInstallation {
    id: u64,
    account: Account,
}

#[derive(Deserialize)]
struct Account {
    login: String,
}

#[derive(Deserialize)]
struct InstallationToken {
    token: String,
}

#[derive(Deserialize)]
struct Repositories {
    repositories: Vec<Repository>,
}

#[derive(Deserialize)]
struct Repository {
    full_name: String,
}

type Answer<T> = std::result::Result<T, GitHubError>;

fn secret(env: &Env, name: &'static str) -> Answer<String> {
    let Ok(value) = env.secret(name) else {
        return Err(GitHubError::SecretMissing(name));
    };
    let value = value.to_string().trim().to_string();
    if value.is_empty() {
        return Err(GitHubError::SecretMissing(name));
    }
    Ok(value)
}

fn js_error(what: &str, error: JsValue) -> Error {
    Error::RustError(format!("{what} failed: {error:?}"))
}

fn pkcs8(pem: &str) -> Answer<Vec<u8>> {
    let body: String = pem
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("-----"))
        .collect();
    if pem.contains("BEGIN RSA PRIVATE KEY") {
        return Err(GitHubError::SecretInvalid(format!(
            "{PRIVATE_KEY} is a PKCS#1 key; convert it with openssl pkcs8 -topk8 -nocrypt"
        )));
    }
    STANDARD
        .decode(body)
        .map_err(|error| GitHubError::SecretInvalid(format!("{PRIVATE_KEY} is not PEM: {error}")))
}

fn algorithm() -> Result<Object> {
    let algorithm = Object::new();
    Reflect::set(&algorithm, &"name".into(), &ALGORITHM.into())?;
    Reflect::set(&algorithm, &"hash".into(), &"SHA-256".into())?;
    Ok(algorithm)
}

async fn sign(der: &[u8], message: &[u8]) -> Result<std::result::Result<Vec<u8>, String>> {
    let scope: web_sys::WorkerGlobalScope = js_sys::global().unchecked_into();
    let subtle = scope.crypto()?.subtle();
    let key_data = Uint8Array::from(der).buffer();
    let usages = Array::of1(&"sign".into());
    let import = subtle
        .import_key_with_object("pkcs8", &key_data, &algorithm()?, false, &usages)
        .map_err(|error| js_error("crypto.subtle.importKey", error))?;
    let key: web_sys::CryptoKey = match JsFuture::from(import).await {
        Ok(key) => key.unchecked_into(),
        Err(error) => return Ok(Err(format!("{PRIVATE_KEY} does not import: {error:?}"))),
    };
    let signing = subtle
        .sign_with_str_and_u8_array(ALGORITHM, &key, message)
        .map_err(|error| js_error("crypto.subtle.sign", error))?;
    let signature = JsFuture::from(signing)
        .await
        .map_err(|error| js_error("crypto.subtle.sign", error))?;
    Ok(Ok(Uint8Array::new(&signature).to_vec()))
}

async fn app_jwt(env: &Env) -> Result<Answer<String>> {
    let app_id = match secret(env, APP_ID) {
        Ok(value) => value,
        Err(error) => return Ok(Err(error)),
    };
    let der = match secret(env, PRIVATE_KEY).and_then(|pem| pkcs8(&pem)) {
        Ok(der) => der,
        Err(error) => return Ok(Err(error)),
    };
    let now = Date::now().as_millis() / 1000;
    let header = URL_SAFE_NO_PAD.encode(json!({ "alg": "RS256", "typ": "JWT" }).to_string());
    let claims = URL_SAFE_NO_PAD
        .encode(json!({ "iat": now - 60, "exp": now + 540, "iss": app_id }).to_string());
    let signed = format!("{header}.{claims}");
    let signature = match sign(&der, signed.as_bytes()).await? {
        Ok(signature) => signature,
        Err(message) => return Ok(Err(GitHubError::SecretInvalid(message))),
    };
    Ok(Ok(format!(
        "{signed}.{}",
        URL_SAFE_NO_PAD.encode(signature)
    )))
}

async fn call<T: DeserializeOwned>(
    method: Method,
    path: &str,
    authorization: &str,
) -> Result<Answer<T>> {
    let headers = Headers::new();
    headers.set("Accept", "application/vnd.github+json")?;
    headers.set("X-GitHub-Api-Version", "2022-11-28")?;
    headers.set("User-Agent", "bugstack")?;
    headers.set("Authorization", authorization)?;
    let mut init = RequestInit::new();
    init.with_method(method.clone()).with_headers(headers);
    let request = Request::new_with_init(&format!("{API}{path}"), &init)?;
    let mut response = Fetch::Request(request).send().await?;
    let status = response.status_code();
    let text = response.text().await?;
    let excerpt: String = text.chars().take(BODY_EXCERPT).collect();
    let label = format!("GitHub {method} {path} answered {status} {excerpt}");
    if status == 404 {
        return Ok(Err(GitHubError::NotFound(label)));
    }
    if !(200..300).contains(&status) {
        return Ok(Err(GitHubError::Failed(label)));
    }
    match serde_json::from_str(&text) {
        Ok(value) => Ok(Ok(value)),
        Err(error) => Ok(Err(GitHubError::Failed(format!(
            "GitHub {method} {path} answered an unexpected body: {error}"
        )))),
    }
}

pub async fn installations(env: &Env) -> Result<Answer<Vec<Installation>>> {
    let jwt = match app_jwt(env).await? {
        Ok(jwt) => jwt,
        Err(error) => return Ok(Err(error)),
    };
    let raw: Answer<Vec<RawInstallation>> = call(
        Method::Get,
        "/app/installations?per_page=100",
        &format!("Bearer {jwt}"),
    )
    .await?;
    Ok(raw.map(|all| {
        all.into_iter()
            .map(|installation| Installation {
                installation_id: installation.id,
                account: installation.account.login,
            })
            .collect()
    }))
}

pub async fn installation_token(env: &Env, installation_id: u64) -> Result<Answer<String>> {
    let jwt = match app_jwt(env).await? {
        Ok(jwt) => jwt,
        Err(error) => return Ok(Err(error)),
    };
    let token: Answer<InstallationToken> = call(
        Method::Post,
        &format!("/app/installations/{installation_id}/access_tokens"),
        &format!("Bearer {jwt}"),
    )
    .await?;
    Ok(token.map(|token| token.token))
}

pub async fn repos(env: &Env, installation_id: u64) -> Result<Answer<Vec<String>>> {
    let token = match installation_token(env, installation_id).await? {
        Ok(token) => token,
        Err(error) => return Ok(Err(error)),
    };
    let repositories: Answer<Repositories> = call(
        Method::Get,
        "/installation/repositories?per_page=100",
        &format!("token {token}"),
    )
    .await?;
    Ok(repositories.map(|all| {
        all.repositories
            .into_iter()
            .map(|repository| repository.full_name)
            .collect()
    }))
}
