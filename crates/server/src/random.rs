use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use js_sys::Uint8Array;
use wasm_bindgen::JsCast;
use worker::{Error, Result};

const ID_LEN: usize = 25;
const ALPHABET: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

pub fn bytes(len: u32) -> Result<Vec<u8>> {
    let scope: web_sys::WorkerGlobalScope = js_sys::global().unchecked_into();
    let buffer = Uint8Array::new_with_length(len);
    scope
        .crypto()?
        .get_random_values_with_js_u8_array(&buffer)
        .map_err(|error| Error::RustError(format!("crypto.getRandomValues failed: {error:?}")))?;
    Ok(buffer.to_vec())
}

pub fn base36(value: u128) -> String {
    let mut digits = [b'0'; ID_LEN];
    let mut rest = value;
    for digit in digits.iter_mut().rev() {
        *digit = ALPHABET[(rest % 36) as usize];
        rest /= 36;
    }
    String::from_utf8_lossy(&digits).into_owned()
}

pub fn id() -> Result<String> {
    let raw: [u8; 16] = bytes(16)?
        .try_into()
        .map_err(|_| Error::RustError("crypto.getRandomValues returned too few bytes".into()))?;
    Ok(base36(u128::from_be_bytes(raw)))
}

pub fn secret() -> Result<String> {
    Ok(URL_SAFE_NO_PAD.encode(bytes(32)?))
}
