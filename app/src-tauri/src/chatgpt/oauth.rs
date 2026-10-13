// The OAuth pieces of Sign in with ChatGPT that need no network: PKCE,
// the authorization URL, the loopback callback, and ID-token checks against
// an already-fetched key set. See
// https://developers.openai.com/siwc/token-sharing-open-source/sign-in.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ring::signature::{RsaPublicKeyComponents, RSA_PKCS1_2048_8192_SHA256};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const ISSUER: &str = "https://auth.openai.com";
pub const DISCOVERY_URL: &str = "https://auth.openai.com/.well-known/openid-configuration";
pub const AUTHORIZE_URL: &str = "https://auth.openai.com/api/accounts/authorize";
pub const TOKEN_URL: &str = "https://auth.openai.com/api/accounts/oauth/token";
pub const REVOKE_URL: &str = "https://auth.openai.com/api/accounts/oauth/revoke";
pub const RESOURCE: &str = "https://api.openai.com/v1";
pub const CALLBACK_PATH: &str = "/auth/callback";
// The first-time registration entrypoint; never saved as a connection's ID.
pub const DYNAMIC_CLIENT_ID: &str = "dynamic_agent_client";
pub const AGENT_NAME: &str = "zvid";
pub const SCOPES: &str =
  "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
// The scope that lets requests use the user's ChatGPT plan.
pub const PLAN_USAGE_SCOPE: &str = "chatgpt.tokens.use.direct";

pub fn random_token(bytes: usize) -> Result<String, String> {
  let mut buffer = vec![0u8; bytes];
  getrandom::fill(&mut buffer).map_err(|error| format!("No secure random source: {error}"))?;
  Ok(URL_SAFE_NO_PAD.encode(buffer))
}

// A random `urn:uuid:` (version 4) identifying this installation.
pub fn new_host_id() -> Result<String, String> {
  let mut bytes = [0u8; 16];
  getrandom::fill(&mut bytes).map_err(|error| format!("No secure random source: {error}"))?;
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
  Ok(format!(
    "urn:uuid:{}-{}-{}-{}-{}",
    &hex[0..8],
    &hex[8..12],
    &hex[12..16],
    &hex[16..20],
    &hex[20..32]
  ))
}

pub fn code_challenge(verifier: &str) -> String {
  URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

// One authorization attempt's fresh values.
pub struct Attempt {
  pub state: String,
  pub nonce: String,
  pub verifier: String,
  pub redirect_uri: String,
  // The issued client ID when reauthorizing a saved registration.
  pub client_id: Option<String>,
}

impl Attempt {
  pub fn new(port: u16, client_id: Option<String>) -> Result<Self, String> {
    Ok(Self {
      state: random_token(32)?,
      nonce: random_token(32)?,
      verifier: random_token(64)?,
      redirect_uri: format!("http://127.0.0.1:{port}{CALLBACK_PATH}"),
      client_id,
    })
  }

  pub fn authorize_url(&self, host_id: &str, id_token_hint: Option<&str>) -> String {
    let mut params: Vec<(&str, &str)> = vec![
      ("response_type", "code"),
      ("client_id", self.client_id.as_deref().unwrap_or(DYNAMIC_CLIENT_ID)),
      ("redirect_uri", &self.redirect_uri),
      ("scope", SCOPES),
      ("resource", RESOURCE),
      ("state", &self.state),
      ("nonce", &self.nonce),
      ("ext_agent_host_id", host_id),
    ];
    let challenge = code_challenge(&self.verifier);
    params.push(("code_challenge_method", "S256"));
    params.push(("code_challenge", &challenge));
    match (&self.client_id, id_token_hint) {
      // Only first-time registration names the app.
      (None, _) => params.push(("agent_name_hint", AGENT_NAME)),
      (Some(_), Some(hint)) => params.push(("id_token_hint", hint)),
      (Some(_), None) => {}
    }
    let query = params
      .iter()
      .map(|(key, value)| format!("{key}={}", encode(value)))
      .collect::<Vec<_>>()
      .join("&");
    format!("{AUTHORIZE_URL}?{query}")
  }
}

fn encode(value: &str) -> String {
  url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}

// The callback request's path and query, from its HTTP request line.
pub fn callback_query(request_line: &str) -> Option<HashMap<String, String>> {
  let mut parts = request_line.split_whitespace();
  if parts.next()? != "GET" {
    return None;
  }
  let target = parts.next()?;
  let (path, query) = target.split_once('?').unwrap_or((target, ""));
  if path != CALLBACK_PATH {
    return None;
  }
  Some(url::form_urlencoded::parse(query.as_bytes()).into_owned().collect())
}

// Validates a callback against its attempt and returns the code and the
// client ID to exchange it with.
pub fn accept_callback(
  attempt: &Attempt,
  query: &HashMap<String, String>,
) -> Result<(String, String), String> {
  if query.get("state").map(String::as_str) != Some(attempt.state.as_str()) {
    return Err("Sign-in failed: the response didn't match this sign-in attempt.".into());
  }
  if let Some(error) = query.get("error") {
    return Err(if error == "access_denied" {
      "Sign-in was canceled.".into()
    } else {
      format!("Sign-in failed: {error}")
    });
  }
  let code = query
    .get("code")
    .filter(|code| !code.is_empty())
    .ok_or("Sign-in failed: no authorization code was returned.")?;
  let returned = query.get("client_id").filter(|id| !id.is_empty());
  let client_id = match (&attempt.client_id, returned) {
    (Some(saved), Some(returned)) if saved != returned => {
      return Err("Sign-in failed: ChatGPT returned a different app registration.".into())
    }
    (Some(saved), _) => saved.clone(),
    (None, Some(returned)) if returned != DYNAMIC_CLIENT_ID => returned.clone(),
    (None, _) => return Err("Sign-in failed: ChatGPT didn't register zvid.".into()),
  };
  Ok((code.clone(), client_id))
}

#[derive(Deserialize)]
pub struct IdClaims {
  pub iss: String,
  pub sub: String,
  pub aud: Audience,
  pub exp: u64,
  pub nonce: Option<String>,
  pub email: Option<String>,
}

#[derive(Deserialize)]
#[serde(untagged)]
pub enum Audience {
  One(String),
  Many(Vec<String>),
}

impl Audience {
  fn contains(&self, client_id: &str) -> bool {
    match self {
      Audience::One(value) => value == client_id,
      Audience::Many(values) => values.iter().any(|value| value == client_id),
    }
  }
}

// The issuer's published signing keys (its JWKS).
#[derive(Clone, Default, Deserialize)]
pub struct KeySet {
  pub keys: Vec<Jwk>,
}

#[derive(Clone, Deserialize)]
pub struct Jwk {
  pub kty: String,
  pub kid: Option<String>,
  pub alg: Option<String>,
  #[serde(rename = "use")]
  pub usage: Option<String>,
  pub n: Option<String>,
  pub e: Option<String>,
}

#[derive(Deserialize)]
struct Header {
  alg: String,
  kid: Option<String>,
}

impl Jwk {
  fn signs_rs256(&self) -> bool {
    self.kty == "RSA"
      && self.alg.as_deref().is_none_or(|alg| alg == "RS256")
      && self.usage.as_deref().is_none_or(|usage| usage == "sig")
  }
}

impl KeySet {
  // The keys that may have signed a token with this header.
  fn candidates<'a>(&'a self, header: &'a Header) -> impl Iterator<Item = &'a Jwk> {
    self
      .keys
      .iter()
      .filter(|key| key.signs_rs256())
      .filter(|key| header.kid.is_none() || key.kid == header.kid)
  }

  // Whether this set holds the key the token names, so a miss can refetch it.
  pub fn has_key_for(&self, id_token: &str) -> bool {
    header(id_token).is_ok_and(|header| self.candidates(&header).next().is_some())
  }
}

fn malformed() -> String {
  "Sign-in failed: the ID token is malformed.".into()
}

fn decode_part(part: &str) -> Result<Vec<u8>, String> {
  URL_SAFE_NO_PAD.decode(part.trim_end_matches('=')).map_err(|_| malformed())
}

fn header(id_token: &str) -> Result<Header, String> {
  let part = id_token.split('.').next().ok_or_else(malformed)?;
  serde_json::from_slice(&decode_part(part)?).map_err(|_| malformed())
}

// Checks an ID token's RS256 signature against the issuer's keys, then its
// issuer, audience, expiry and nonce.
pub fn verify_id_token(
  id_token: &str,
  keys: &KeySet,
  client_id: &str,
  nonce: Option<&str>,
  now: u64,
) -> Result<IdClaims, String> {
  let parts: Vec<&str> = id_token.split('.').collect();
  let [encoded_header, payload, signature] = parts[..] else {
    return Err(malformed());
  };
  let header = header(id_token)?;
  if header.alg != "RS256" {
    return Err("Sign-in failed: the ID token isn't signed the way ChatGPT signs it.".into());
  }
  let signature = decode_part(signature)?;
  let signed = format!("{encoded_header}.{payload}");
  let mut candidates = keys.candidates(&header).peekable();
  if candidates.peek().is_none() {
    return Err("Sign-in failed: the ID token is signed with an unknown key.".into());
  }
  let verified = candidates.any(|key| {
    let (Some(n), Some(e)) = (&key.n, &key.e) else {
      return false;
    };
    let (Ok(n), Ok(e)) = (decode_part(n), decode_part(e)) else {
      return false;
    };
    RsaPublicKeyComponents { n, e }
      .verify(&RSA_PKCS1_2048_8192_SHA256, signed.as_bytes(), &signature)
      .is_ok()
  });
  if !verified {
    return Err("Sign-in failed: the ID token's signature doesn't verify.".into());
  }
  let claims: IdClaims = serde_json::from_slice(&decode_part(payload)?).map_err(|_| malformed())?;
  if claims.iss != ISSUER {
    return Err("Sign-in failed: the ID token has the wrong issuer.".into());
  }
  if !claims.aud.contains(client_id) {
    return Err("Sign-in failed: the ID token is for another app.".into());
  }
  if claims.exp <= now {
    return Err("Sign-in failed: the ID token has expired.".into());
  }
  if let Some(expected) = nonce {
    if claims.nonce.as_deref() != Some(expected) {
      return Err("Sign-in failed: the ID token doesn't match this sign-in attempt.".into());
    }
  }
  Ok(claims)
}

pub fn split_scopes(scope: &str) -> Vec<String> {
  let mut scopes: Vec<String> = scope.split_whitespace().map(str::to_string).collect();
  scopes.sort();
  scopes.dedup();
  scopes
}

#[cfg(test)]
mod tests {
  use super::*;

  fn attempt(client_id: Option<&str>) -> Attempt {
    let mut attempt = Attempt::new(1455, client_id.map(str::to_string)).unwrap();
    attempt.state = "state-1".into();
    attempt
  }

  fn query(pairs: &[(&str, &str)]) -> HashMap<String, String> {
    pairs.iter().map(|(key, value)| (key.to_string(), value.to_string())).collect()
  }

  fn test_keys() -> KeySet {
    serde_json::from_str(include_str!("testdata/id_token_keys.json")).unwrap()
  }

  fn sign(header: serde_json::Value, claims: &serde_json::Value) -> String {
    use ring::signature::{RsaKeyPair, RSA_PKCS1_SHA256};
    let key = RsaKeyPair::from_der(include_bytes!("testdata/id_token_key.der")).unwrap();
    let signed = format!(
      "{}.{}",
      URL_SAFE_NO_PAD.encode(header.to_string()),
      URL_SAFE_NO_PAD.encode(claims.to_string())
    );
    let mut signature = vec![0; key.public().modulus_len()];
    key
      .sign(&RSA_PKCS1_SHA256, &ring::rand::SystemRandom::new(), signed.as_bytes(), &mut signature)
      .unwrap();
    format!("{signed}.{}", URL_SAFE_NO_PAD.encode(signature))
  }

  fn id_token(claims: serde_json::Value) -> String {
    sign(serde_json::json!({ "alg": "RS256", "kid": "test-key" }), &claims)
  }

  fn claims() -> serde_json::Value {
    serde_json::json!({
      "iss": ISSUER, "sub": "user-1", "aud": ["oaiapp_1"], "exp": 2000,
      "nonce": "n", "email": "user@example.com"
    })
  }

  #[test]
  fn builds_registration_and_reauthorization_urls() {
    let first = attempt(None).authorize_url("urn:uuid:host", Some("hint"));
    assert!(first.starts_with(AUTHORIZE_URL));
    assert!(first.contains("client_id=dynamic_agent_client"));
    assert!(first.contains("agent_name_hint=zvid"));
    assert!(first.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A1455%2Fauth%2Fcallback"));
    assert!(first.contains("ext_agent_host_id=urn%3Auuid%3Ahost"));
    assert!(first.contains("chatgpt.tokens.use.direct"));
    assert!(first.contains("code_challenge_method=S256"));
    assert!(!first.contains("id_token_hint"));

    let again = attempt(Some("oaiapp_1")).authorize_url("urn:uuid:host", Some("hint"));
    assert!(again.contains("client_id=oaiapp_1"));
    assert!(again.contains("id_token_hint=hint"));
    assert!(!again.contains("agent_name_hint"));
  }

  #[test]
  fn pkce_challenge_matches_rfc_7636_example() {
    assert_eq!(
      code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  }

  #[test]
  fn host_ids_are_uuid_urns() {
    let id = new_host_id().unwrap();
    assert!(id.starts_with("urn:uuid:"));
    assert_eq!(id.len(), "urn:uuid:".len() + 36);
    assert_eq!(&id[23..24], "4");
    assert_ne!(id, new_host_id().unwrap());
  }

  #[test]
  fn reads_only_callback_requests() {
    let parsed = callback_query("GET /auth/callback?code=c&state=s HTTP/1.1").unwrap();
    assert_eq!(parsed["code"], "c");
    assert!(callback_query("GET /favicon.ico HTTP/1.1").is_none());
    assert!(callback_query("POST /auth/callback?code=c HTTP/1.1").is_none());
  }

  #[test]
  fn accepts_registration_callbacks() {
    let pending = attempt(None);
    let accepted =
      accept_callback(&pending, &query(&[("state", "state-1"), ("code", "c"), ("client_id", "oaiapp_9")]));
    assert_eq!(accepted.unwrap(), ("c".to_string(), "oaiapp_9".to_string()));

    let unregistered = accept_callback(&pending, &query(&[("state", "state-1"), ("code", "c")]));
    assert!(unregistered.is_err());
    let forged = accept_callback(&pending, &query(&[("state", "other"), ("code", "c"), ("client_id", "x")]));
    assert!(forged.unwrap_err().contains("didn't match"));
    let denied = accept_callback(&pending, &query(&[("state", "state-1"), ("error", "access_denied")]));
    assert_eq!(denied.unwrap_err(), "Sign-in was canceled.");
  }

  #[test]
  fn keeps_the_saved_client_on_reauthorization() {
    let pending = attempt(Some("oaiapp_1"));
    let omitted = accept_callback(&pending, &query(&[("state", "state-1"), ("code", "c")]));
    assert_eq!(omitted.unwrap().1, "oaiapp_1");
    let swapped =
      accept_callback(&pending, &query(&[("state", "state-1"), ("code", "c"), ("client_id", "oaiapp_2")]));
    assert!(swapped.is_err());
  }

  #[test]
  fn verifies_id_token_claims() {
    let keys = test_keys();
    let claims = claims();
    let token = id_token(claims.clone());
    let verified = verify_id_token(&token, &keys, "oaiapp_1", Some("n"), 1000).unwrap();
    assert_eq!(verified.sub, "user-1");
    assert_eq!(verified.email.as_deref(), Some("user@example.com"));
    // Refreshed tokens carry no nonce to check.
    assert!(verify_id_token(&token, &keys, "oaiapp_1", None, 1000).is_ok());

    assert!(verify_id_token(&token, &keys, "oaiapp_2", Some("n"), 1000).is_err());
    assert!(verify_id_token(&token, &keys, "oaiapp_1", Some("other"), 1000).is_err());
    assert!(verify_id_token(&token, &keys, "oaiapp_1", Some("n"), 3000).is_err());
    let mut wrong_issuer = claims;
    wrong_issuer["iss"] = "https://example.com".into();
    assert!(verify_id_token(&id_token(wrong_issuer), &keys, "oaiapp_1", Some("n"), 1000).is_err());
    assert!(verify_id_token("not-a-jwt", &keys, "oaiapp_1", None, 1000).is_err());
  }

  #[test]
  fn rejects_tampered_id_tokens() {
    let keys = test_keys();
    let token = id_token(claims());
    let mut forged = claims();
    forged["sub"] = "user-2".into();
    let mut parts: Vec<String> = token.split('.').map(str::to_string).collect();
    parts[1] = URL_SAFE_NO_PAD.encode(forged.to_string());
    let tampered = parts.join(".");
    let error = verify_id_token(&tampered, &keys, "oaiapp_1", Some("n"), 1000).err().unwrap();
    assert!(error.contains("signature doesn't verify"), "{error}");

    // An unsigned token can't pass as RS256.
    parts[0] = URL_SAFE_NO_PAD.encode(r#"{"alg":"none","kid":"test-key"}"#);
    parts[2] = String::new();
    assert!(verify_id_token(&parts.join("."), &keys, "oaiapp_1", Some("n"), 1000).is_err());
  }

  #[test]
  fn rejects_id_tokens_from_unknown_keys() {
    let keys = test_keys();
    let token = sign(serde_json::json!({ "alg": "RS256", "kid": "rotated" }), &claims());
    assert!(!keys.has_key_for(&token));
    let error = verify_id_token(&token, &keys, "oaiapp_1", Some("n"), 1000).err().unwrap();
    assert!(error.contains("unknown key"), "{error}");
    assert!(keys.has_key_for(&id_token(claims())));
    assert!(!KeySet::default().has_key_for(&id_token(claims())));
  }

  #[test]
  fn splits_granted_scopes() {
    assert_eq!(
      split_scopes("openid email chatgpt.tokens.use.direct email"),
      vec!["chatgpt.tokens.use.direct", "email", "openid"]
    );
  }
}
