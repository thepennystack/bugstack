use std::cell::{Cell, RefCell};
use std::rc::Rc;

use serde::Serialize;
use serde_json::{Value, json};
use worker::*;

use crate::auth::{self, Access, AccessApp, Identity, Keys};
use crate::{refuse, routes};

const LOCAL_ADMIN: &str = "local";

thread_local! {
    static ACCESS_KEYS: RefCell<Option<(u64, Rc<Keys>)>> = const { RefCell::new(None) };
    static LOGGED_DISABLED: Cell<bool> = const { Cell::new(false) };
}

pub struct ApiRequest {
    pub method: Method,
    pub path: String,
    pub admin: String,
    pub body: Value,
}

#[derive(Serialize)]
pub struct Me {
    pub email: String,
}

enum Caller {
    Admin(String),
    Denied(String),
}

async fn access_keys(app: &AccessApp) -> Result<Rc<Keys>> {
    let now = Date::now().as_millis();
    let cached = ACCESS_KEYS.with_borrow(|cache| {
        cache
            .as_ref()
            .filter(|(fetched, _)| now.saturating_sub(*fetched) < auth::KEYS_TTL_MS)
            .map(|(_, keys)| keys.clone())
    });
    if let Some(keys) = cached {
        return Ok(keys);
    }
    let mut response = Fetch::Url(Url::parse(&app.certs_url())?).send().await?;
    if response.status_code() != 200 {
        return Err(Error::RustError(format!(
            "{} returned {}",
            app.certs_url(),
            response.status_code()
        )));
    }
    let keys = Rc::new(auth::parse_keys(&response.text().await?).map_err(Error::RustError)?);
    ACCESS_KEYS.set(Some((now, keys.clone())));
    Ok(keys)
}

fn var(env: &Env, name: &str) -> Result<String> {
    Ok(env.var(name)?.to_string().trim().to_string())
}

fn admit(identity: Identity, admin_email: &str, admin_client_id: &str) -> Caller {
    match identity {
        Identity::User { email } if !admin_email.is_empty() && email == admin_email => {
            Caller::Admin(email)
        }
        Identity::ServiceToken { common_name }
            if !admin_client_id.is_empty() && common_name == admin_client_id =>
        {
            Caller::Admin(common_name)
        }
        Identity::User { email } => Caller::Denied(format!("{email} is not the admin")),
        Identity::ServiceToken { common_name } => {
            Caller::Denied(format!("service token {common_name} is not the admin"))
        }
    }
}

async fn caller(req: &Request, env: &Env) -> Result<Caller> {
    let access = Access::from_vars(&var(env, "ACCESS_TEAM_DOMAIN")?, &var(env, "ACCESS_AUD")?)
        .map_err(Error::RustError)?;
    let Access::Enabled(app) = access else {
        if !LOGGED_DISABLED.replace(true) {
            console_log!(
                "Cloudflare Access is disabled: ACCESS_TEAM_DOMAIN and ACCESS_AUD are empty"
            );
        }
        return Ok(Caller::Admin(LOCAL_ADMIN.into()));
    };
    let assertion = req.headers().get(auth::ASSERTION_HEADER)?;
    let cookie = req.headers().get("Cookie")?;
    let Some(token) = auth::token(assertion.as_deref(), cookie.as_deref()) else {
        return Ok(Caller::Denied("no Access token".into()));
    };
    let keys = access_keys(&app).await?;
    let identity = match auth::verify(token, &keys, &app, Date::now().as_millis() / 1000) {
        Ok(identity) => identity,
        Err(reason) => return Ok(Caller::Denied(reason)),
    };
    Ok(admit(
        identity,
        &var(env, "ADMIN_EMAIL")?,
        &var(env, "ADMIN_CLIENT_ID")?,
    ))
}

fn is_json(req: &Request) -> Result<bool> {
    Ok(req
        .headers()
        .get("content-type")?
        .and_then(|value| value.split(';').next().map(str::trim).map(str::to_string))
        .is_some_and(|mime| mime.eq_ignore_ascii_case("application/json")))
}

fn unsupported() -> Result<Response> {
    refuse(
        415,
        "UnsupportedMediaType",
        "send the request body as content-type: application/json",
    )
}

async fn body(req: &mut Request) -> Result<std::result::Result<Value, Response>> {
    let method = req.method();
    let writes = matches!(method, Method::Post | Method::Put);
    if writes && !is_json(req)? {
        return Ok(Err(unsupported()?));
    }
    if !writes && method != Method::Delete {
        return Ok(Ok(json!({})));
    }
    let text = req.text().await?;
    if text.trim().is_empty() {
        return Ok(Ok(json!({})));
    }
    if !is_json(req)? {
        return Ok(Err(unsupported()?));
    }
    match serde_json::from_str(&text) {
        Ok(value) => Ok(Ok(value)),
        Err(error) => Ok(Err(refuse(
            400,
            "Invalid",
            &format!("the body is not valid JSON: {error}"),
        )?)),
    }
}

pub async fn handle(mut req: Request, env: &Env) -> Result<Response> {
    let admin = match caller(&req, env).await? {
        Caller::Admin(admin) => admin,
        Caller::Denied(reason) => {
            console_log!("Access rejected the request: {reason}");
            return refuse(
                401,
                "Unauthorized",
                "sign in through Cloudflare Access as the bugstack admin",
            );
        }
    };
    let body = match body(&mut req).await? {
        Ok(body) => body,
        Err(response) => return Ok(response),
    };
    routes::route(
        ApiRequest {
            method: req.method(),
            path: req.url()?.path().to_string(),
            admin,
            body,
        },
        env,
    )
    .await
}
