use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

pub const CLIENT_HEADER: &str = "X-Bugstack-Client";
pub const TIMESTAMP_HEADER: &str = "X-Bugstack-Timestamp";
pub const SIGNATURE_HEADER: &str = "X-Bugstack-Signature";
pub const WINDOW_SECONDS: i64 = 300;
pub const ACTIVE: &str = "Active";

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Valid,
    MissingSignature,
    StaleTimestamp,
    UnknownClient,
    BadSignature,
}

#[derive(Deserialize)]
pub struct SigningClient {
    pub app_id: String,
    pub status: String,
    pub secret: String,
}

pub fn secret_for<'a>(client: Option<&'a SigningClient>, app_id: &str) -> Option<&'a str> {
    client
        .filter(|client| client.status == ACTIVE && client.app_id == app_id)
        .map(|client| client.secret.as_str())
}

pub fn verify(
    secret: Option<&str>,
    timestamp: Option<&str>,
    body: &[u8],
    signature: Option<&str>,
    now: i64,
) -> Verdict {
    let (Some(timestamp), Some(signature)) = (timestamp, signature) else {
        return Verdict::MissingSignature;
    };
    let Ok(sent) = timestamp.parse::<i64>() else {
        return Verdict::StaleTimestamp;
    };
    if now.abs_diff(sent) > WINDOW_SECONDS.unsigned_abs() {
        return Verdict::StaleTimestamp;
    }
    let Some(secret) = secret else {
        return Verdict::UnknownClient;
    };
    let Ok(expected) = hex::decode(signature) else {
        return Verdict::BadSignature;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
        return Verdict::BadSignature;
    };
    mac.update(timestamp.as_bytes());
    mac.update(b".");
    mac.update(body);
    match mac.verify_slice(&expected) {
        Ok(()) => Verdict::Valid,
        Err(_) => Verdict::BadSignature,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "s3cr3t-key";
    const SENT: i64 = 1_700_000_000;
    const TIMESTAMP: &str = "1700000000";
    const BODY: &[u8] = br#"{"title":"Boom"}"#;
    const SIGNATURE: &str = "233fa31f18b863b8f72f1616c8bd52d1e847916f359f7a17276c34a890814324";
    const APP: &str = "app-one";

    fn check(timestamp: &str, body: &[u8], now: i64) -> Verdict {
        verify(Some(SECRET), Some(timestamp), body, Some(SIGNATURE), now)
    }

    fn client(app_id: &str, status: &str) -> SigningClient {
        SigningClient {
            app_id: app_id.into(),
            status: status.into(),
            secret: SECRET.into(),
        }
    }

    #[test]
    fn hmac_check() {
        assert_eq!(check(TIMESTAMP, BODY, SENT), Verdict::Valid);
        assert_eq!(
            check(TIMESTAMP, br#"{"title":"Bang"}"#, SENT),
            Verdict::BadSignature
        );
        assert_eq!(check("1700000001", BODY, SENT), Verdict::BadSignature);
        assert_eq!(check(TIMESTAMP, BODY, SENT + 300), Verdict::Valid);
        assert_eq!(check(TIMESTAMP, BODY, SENT - 300), Verdict::Valid);
        assert_eq!(check(TIMESTAMP, BODY, SENT + 301), Verdict::StaleTimestamp);
        assert_eq!(check(TIMESTAMP, BODY, SENT - 301), Verdict::StaleTimestamp);
        assert_eq!(
            verify(Some(SECRET), None, BODY, Some(SIGNATURE), SENT),
            Verdict::MissingSignature
        );
        assert_eq!(
            verify(Some(SECRET), Some(TIMESTAMP), BODY, None, SENT),
            Verdict::MissingSignature
        );
        assert_eq!(
            verify(Some(SECRET), Some(TIMESTAMP), BODY, Some("zz"), SENT),
            Verdict::BadSignature
        );

        let active = client(APP, ACTIVE);
        let revoked = client(APP, "Revoked");
        let foreign = client("app-two", ACTIVE);
        assert_eq!(secret_for(Some(&active), APP), Some(SECRET));
        for secret in [
            secret_for(Some(&revoked), APP),
            secret_for(Some(&foreign), APP),
            secret_for(None, APP),
        ] {
            assert_eq!(
                verify(secret, Some(TIMESTAMP), BODY, Some(SIGNATURE), SENT),
                Verdict::UnknownClient
            );
        }
    }
}
