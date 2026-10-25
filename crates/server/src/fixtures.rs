use worker::{Env, Response, Result};

use crate::github::Credentials;
use crate::refuse;

pub struct NotBootstrapped(pub String);

impl NotBootstrapped {
    pub fn message(&self) -> String {
        format!("{}; run npm run bootstrap", self.0)
    }

    pub fn failure(&self) -> String {
        format!("NotBootstrapped {}", self.message())
    }

    pub fn response(&self) -> Result<Response> {
        refuse(503, "NotBootstrapped", &self.message())
    }
}

pub type Fixture<T> = std::result::Result<T, NotBootstrapped>;

pub struct GitHubFixture {
    pub app_id: u64,
    pub private_key: String,
}

impl GitHubFixture {
    pub fn credentials(&self) -> Credentials<'_> {
        Credentials {
            app_id_number: self.app_id,
            private_key: &self.private_key,
        }
    }
}

pub struct SlackFixture {
    pub client_id: String,
    pub client_secret: String,
}

fn secret(env: &Env, name: &str) -> Fixture<String> {
    env.secret(name)
        .ok()
        .map(|value| value.to_string().trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| NotBootstrapped(format!("the Worker secret {name} is not set")))
}

pub fn github_slug(env: &Env) -> Fixture<String> {
    secret(env, "GITHUB_APP_SLUG")
}

pub fn github(env: &Env) -> Fixture<GitHubFixture> {
    let raw_id = secret(env, "GITHUB_APP_ID")?;
    let app_id = raw_id.parse::<u64>().map_err(|_| {
        NotBootstrapped(format!(
            "the Worker secret GITHUB_APP_ID must be the numeric app id, not {raw_id:?}"
        ))
    })?;
    Ok(GitHubFixture {
        app_id,
        private_key: secret(env, "GITHUB_PRIVATE_KEY")?,
    })
}

pub fn slack(env: &Env) -> Fixture<SlackFixture> {
    Ok(SlackFixture {
        client_id: secret(env, "SLACK_CLIENT_ID")?,
        client_secret: secret(env, "SLACK_CLIENT_SECRET")?,
    })
}
