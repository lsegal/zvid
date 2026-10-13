// Sign in with ChatGPT for the desktop app: the user's own ChatGPT plan pays
// for the prompt box's requests, with no API key. Tokens stay in this
// process; the webview only sees the connection's status and the model's
// completed responses.
mod oauth;
mod responses;
mod store;

use responses::{ChatGptError, StreamReader};
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use store::{Credentials, Store};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

const USAGE_URL: &str = "https://chatgpt.com/settings/usage";
const PREFERRED_CALLBACK_PORT: u16 = 1455;
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(300);
// Refresh this long before the access token expires.
const REFRESH_MARGIN_SECS: u64 = 120;
const REFRESH_FAILURE_CODES: &[&str] = &[
  "invalid_grant",
  "invalid_refresh_token",
  "token_expired",
  "refresh_token_expired",
  "refresh_token_invalidated",
  "refresh_token_reused",
];

pub struct ChatGpt {
  store: Store,
  http: reqwest::Client,
  // Locked across a refresh, so two requests never race a rotating token.
  credentials: Mutex<Option<Credentials>>,
  model: Mutex<Option<String>>,
  // The issuer's signing keys, fetched on first use.
  keys: Mutex<Option<oauth::KeySet>>,
  // Cancels the sign-in waiting on the browser, if any.
  pending_sign_in: std::sync::Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
  signed_in: bool,
  email: Option<String>,
  plan_usage: bool,
  // Set when signing out couldn't confirm the session was revoked.
  notice: Option<String>,
}

fn status(credentials: Option<&Credentials>) -> Status {
  Status {
    signed_in: credentials.is_some_and(Credentials::signed_in),
    email: credentials.and_then(|value| value.email.clone()),
    plan_usage: credentials.is_some_and(Credentials::plan_usage),
    notice: None,
  }
}

fn now() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .map_or(0, |elapsed| elapsed.as_secs())
}

impl ChatGpt {
  pub fn new(dir: PathBuf) -> Self {
    let store = Store::new(dir);
    let credentials = store.credentials();
    Self {
      store,
      http: reqwest::Client::new(),
      credentials: Mutex::new(credentials),
      model: Mutex::new(None),
      keys: Mutex::new(None),
      pending_sign_in: std::sync::Mutex::new(None),
    }
  }

  async fn token_request(&self, form: &[(&str, &str)]) -> Result<Value, ChatGptError> {
    let response = self
      .http
      .post(oauth::TOKEN_URL)
      .form(form)
      .send()
      .await
      .map_err(|error| format!("Couldn't reach ChatGPT: {error}"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    let value: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    if status.is_success() {
      return Ok(value);
    }
    let code = value
      .get("error")
      .and_then(|error| error.as_str().or_else(|| error.get("code").and_then(Value::as_str)))
      .unwrap_or("token_request_failed");
    Err(ChatGptError::with_code(
      code,
      format!("ChatGPT sign-in failed ({}): {code}", status.as_u16()),
    ))
  }

  async fn get_json(&self, url: &str) -> Result<Value, ChatGptError> {
    let response = self
      .http
      .get(url)
      .send()
      .await
      .and_then(reqwest::Response::error_for_status)
      .map_err(|error| format!("Couldn't reach ChatGPT: {error}"))?;
    Ok(response.json().await.map_err(|error| format!("Couldn't reach ChatGPT: {error}"))?)
  }

  // The issuer's current signing keys, from the URL its discovery document
  // names.
  async fn fetch_keys(&self) -> Result<oauth::KeySet, ChatGptError> {
    let discovery = self.get_json(oauth::DISCOVERY_URL).await?;
    let jwks_uri = discovery
      .get("jwks_uri")
      .and_then(Value::as_str)
      .filter(|uri| uri.starts_with("https://"))
      .ok_or("Sign-in failed: ChatGPT didn't publish its signing keys.")?;
    let keys = self.get_json(jwks_uri).await?;
    let keys = serde_json::from_value(keys)
      .map_err(|_| "Sign-in failed: ChatGPT's signing keys are malformed.")?;
    Ok(keys)
  }

  // Verifies an ID token against the cached keys, refetching them once when
  // the token names a key the cache lacks (the issuer rotated its keys).
  async fn verify_id_token(
    &self,
    id_token: &str,
    client_id: &str,
    nonce: Option<&str>,
  ) -> Result<oauth::IdClaims, ChatGptError> {
    let mut keys = self.keys.lock().await;
    if !keys.as_ref().is_some_and(|keys| keys.has_key_for(id_token)) {
      *keys = Some(self.fetch_keys().await?);
    }
    let keys = keys.as_ref().expect("keys were just fetched");
    Ok(oauth::verify_id_token(id_token, keys, client_id, nonce, now())?)
  }

  // Applies a token response to `credentials`, keeping any field it omits.
  fn apply_tokens(credentials: &mut Credentials, tokens: &Value) -> Result<(), ChatGptError> {
    let text = |key: &str| tokens.get(key).and_then(Value::as_str).map(str::to_string);
    credentials.access_token = Some(text("access_token").ok_or("ChatGPT returned no access token.")?);
    if let Some(refresh) = text("refresh_token") {
      credentials.refresh_token = Some(refresh);
    }
    if let Some(id_token) = text("id_token") {
      credentials.id_token = Some(id_token);
    }
    if let Some(scope) = text("scope") {
      credentials.scopes = oauth::split_scopes(&scope);
    }
    let expires_in = tokens.get("expires_in").and_then(Value::as_u64).unwrap_or(3600);
    credentials.expires_at = now() + expires_in;
    Ok(())
  }

  // The access token, refreshed first when it's about to expire.
  async fn access_token(&self) -> Result<String, ChatGptError> {
    let mut guard = self.credentials.lock().await;
    let credentials = guard
      .as_mut()
      .filter(|value| value.signed_in())
      .ok_or_else(|| ChatGptError::with_code("signed_out", "Sign in with ChatGPT first."))?;
    if !credentials.plan_usage() {
      return Err(ChatGptError::with_code(
        "plan_usage_disabled",
        "zvid doesn't have permission to use your ChatGPT plan. Sign in again and allow it.",
      ));
    }
    if credentials.expires_at > now() + REFRESH_MARGIN_SECS {
      return Ok(credentials.access_token.clone().unwrap_or_default());
    }
    let refresh_token = credentials.refresh_token.clone().unwrap_or_default();
    let refreshed = self
      .token_request(&[
        ("grant_type", "refresh_token"),
        ("client_id", &credentials.client_id),
        ("refresh_token", &refresh_token),
        ("resource", oauth::RESOURCE),
      ])
      .await;
    let tokens = match refreshed {
      Ok(tokens) => tokens,
      Err(error) => {
        if error.code.as_deref().is_some_and(|code| REFRESH_FAILURE_CODES.contains(&code)) {
          credentials.sign_out();
          self.store.save(credentials)?;
          return Err(ChatGptError::with_code(
            "signed_out",
            "Your ChatGPT sign-in expired. Sign in again.",
          ));
        }
        return Err(error);
      }
    };
    let mut next = credentials.clone();
    Self::apply_tokens(&mut next, &tokens)?;
    if let Some(id_token) = tokens.get("id_token").and_then(Value::as_str) {
      let claims = self.verify_id_token(id_token, &next.client_id, None).await?;
      if claims.sub != next.subject {
        return Err("ChatGPT returned a different account's sign-in.".into());
      }
    }
    self.store.save(&next)?;
    *credentials = next;
    Ok(credentials.access_token.clone().unwrap_or_default())
  }

  async fn model(&self, token: &str) -> Result<String, ChatGptError> {
    let mut model = self.model.lock().await;
    if let Some(slug) = model.as_ref() {
      return Ok(slug.clone());
    }
    let response = self
      .http
      .get(format!("{}/models", oauth::RESOURCE))
      .bearer_auth(token)
      .send()
      .await
      .map_err(|error| format!("Couldn't reach ChatGPT: {error}"))?;
    let status = response.status().as_u16();
    let body = response.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
      return Err(responses::http_error(status, &body));
    }
    let catalog: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
    let slug = responses::first_listed_model(&catalog).ok_or_else(|| {
      ChatGptError::with_code("no_models", "Your ChatGPT plan has no models available to zvid.")
    })?;
    *model = Some(slug.clone());
    Ok(slug)
  }
}

#[tauri::command]
pub async fn chatgpt_status(chatgpt: State<'_, ChatGpt>) -> Result<Status, ChatGptError> {
  Ok(status(chatgpt.credentials.lock().await.as_ref()))
}

// Waits for the browser to return to the loopback callback, answering it
// with a page that tells the user to go back to zvid.
async fn await_callback(
  listener: TcpListener,
  attempt: &oauth::Attempt,
) -> Result<(String, String), ChatGptError> {
  loop {
    let (mut socket, _) = listener
      .accept()
      .await
      .map_err(|error| format!("Sign-in failed: {error}"))?;
    let mut request = Vec::new();
    let mut chunk = [0u8; 2048];
    while !request.windows(4).any(|window| window == b"\r\n\r\n") && request.len() < 16_384 {
      match socket.read(&mut chunk).await {
        Ok(0) | Err(_) => break,
        Ok(read) => request.extend_from_slice(&chunk[..read]),
      }
    }
    let text = String::from_utf8_lossy(&request);
    let Some(query) = oauth::callback_query(text.lines().next().unwrap_or_default()) else {
      let _ = socket
        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        .await;
      continue;
    };
    let result = oauth::accept_callback(attempt, &query);
    let message = match &result {
      Ok(_) => "You're signed in. You can close this tab and return to zvid.".to_string(),
      Err(error) => format!("{error} You can close this tab and return to zvid."),
    };
    let page = format!(
      "<!doctype html><meta charset=utf-8><title>zvid</title><body style=\"font:16px system-ui;margin:3em\"><p>{message}</p>"
    );
    let _ = socket
      .write_all(
        format!(
          "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{page}",
          page.len()
        )
        .as_bytes(),
      )
      .await;
    return result.map_err(ChatGptError::from);
  }
}

#[tauri::command]
pub async fn chatgpt_sign_in(
  app: AppHandle,
  chatgpt: State<'_, ChatGpt>,
) -> Result<Status, ChatGptError> {
  let (cancel, canceled) = oneshot::channel();
  if let Some(previous) = chatgpt.pending_sign_in.lock().unwrap().replace(cancel) {
    let _ = previous.send(());
  }
  let host_id = chatgpt.store.host_id()?;
  let saved = chatgpt.credentials.lock().await.clone();
  let client_id = saved.as_ref().map(|value| value.client_id.clone()).filter(|id| !id.is_empty());
  let listener = match TcpListener::bind(("127.0.0.1", PREFERRED_CALLBACK_PORT)).await {
    Ok(listener) => listener,
    Err(_) => TcpListener::bind(("127.0.0.1", 0))
      .await
      .map_err(|error| format!("Sign-in failed: {error}"))?,
  };
  let port = listener.local_addr().map_err(|error| error.to_string())?.port();
  let attempt = oauth::Attempt::new(port, client_id)?;
  let hint = saved.as_ref().and_then(|value| value.id_token.as_deref());
  app
    .opener()
    .open_url(attempt.authorize_url(&host_id, hint), None::<&str>)
    .map_err(|error| format!("Couldn't open the browser: {error}"))?;

  let (code, client_id) = tokio::select! {
    result = await_callback(listener, &attempt) => result?,
    _ = canceled => return Err(ChatGptError::with_code("canceled", "Sign-in was canceled.")),
    _ = tokio::time::sleep(SIGN_IN_TIMEOUT) => {
      return Err(ChatGptError::with_code("timeout", "Sign-in timed out. Try again."))
    }
  };
  // Saves a new registration's issued client before the exchange, so a
  // retry reuses it.
  let mut next = match saved {
    Some(saved) if saved.client_id == client_id => saved,
    _ => Credentials {
      client_id: client_id.clone(),
      ..Credentials::default()
    },
  };
  if next.subject.is_empty() {
    chatgpt.store.save(&next)?;
    *chatgpt.credentials.lock().await = Some(next.clone());
  }
  let tokens = chatgpt
    .token_request(&[
      ("grant_type", "authorization_code"),
      ("client_id", &client_id),
      ("code", &code),
      ("code_verifier", &attempt.verifier),
      ("redirect_uri", &attempt.redirect_uri),
      ("resource", oauth::RESOURCE),
    ])
    .await?;
  let id_token = tokens
    .get("id_token")
    .and_then(Value::as_str)
    .ok_or("Sign-in failed: ChatGPT returned no ID token.")?;
  let claims = chatgpt
    .verify_id_token(id_token, &client_id, Some(&attempt.nonce))
    .await?;
  if !next.subject.is_empty() && next.subject != claims.sub {
    return Err("Sign-in failed: that's a different ChatGPT account than this registration.".into());
  }
  next.subject = claims.sub;
  next.email = claims.email;
  ChatGpt::apply_tokens(&mut next, &tokens)?;
  chatgpt.store.save(&next)?;
  let result = status(Some(&next));
  *chatgpt.credentials.lock().await = Some(next);
  *chatgpt.model.lock().await = None;
  Ok(result)
}

#[tauri::command]
pub fn chatgpt_cancel_sign_in(chatgpt: State<'_, ChatGpt>) {
  if let Some(pending) = chatgpt.pending_sign_in.lock().unwrap().take() {
    let _ = pending.send(());
  }
}

#[tauri::command]
pub async fn chatgpt_sign_out(chatgpt: State<'_, ChatGpt>) -> Result<Status, ChatGptError> {
  let mut guard = chatgpt.credentials.lock().await;
  let Some(credentials) = guard.as_mut() else {
    return Ok(status(None));
  };
  let mut revoked = true;
  if let Some(refresh_token) = credentials.refresh_token.clone() {
    revoked = false;
    for attempt in 0..3 {
      let response = chatgpt
        .http
        .post(oauth::REVOKE_URL)
        .form(&[
          ("token", refresh_token.as_str()),
          ("token_type_hint", "refresh_token"),
          ("client_id", credentials.client_id.as_str()),
        ])
        .send()
        .await;
      match response {
        Ok(response) if response.status().is_success() => {
          revoked = true;
          break;
        }
        Ok(response) if !response.status().is_server_error() => break,
        _ => tokio::time::sleep(Duration::from_millis(500 << attempt)).await,
      }
    }
  }
  credentials.sign_out();
  chatgpt.store.save(credentials)?;
  *chatgpt.model.lock().await = None;
  let mut result = status(Some(credentials));
  if !revoked {
    result.notice = Some(
      "Signed out of zvid, but ChatGPT didn't confirm it. You can disconnect zvid in ChatGPT settings."
        .into(),
    );
  }
  Ok(result)
}

#[tauri::command]
pub fn chatgpt_open_usage(app: AppHandle) -> Result<(), ChatGptError> {
  app
    .opener()
    .open_url(USAGE_URL, None::<&str>)
    .map_err(|error| ChatGptError::new(format!("Couldn't open the browser: {error}")))
}

// Sends one Responses API request and returns its completed response. The
// webview supplies `instructions`, `input` and `tools`; this fills in the
// model and the settings ChatGPT plan usage requires.
#[tauri::command]
pub async fn chatgpt_respond(
  chatgpt: State<'_, ChatGpt>,
  request: Value,
) -> Result<Value, ChatGptError> {
  let Value::Object(mut body) = request else {
    return Err("The request must be a JSON object.".into());
  };
  let token = chatgpt.access_token().await?;
  let model = chatgpt.model(&token).await?;
  body.insert("model".into(), Value::String(model));
  body.insert("store".into(), Value::Bool(false));
  body.insert("stream".into(), Value::Bool(true));
  let mut response = chatgpt
    .http
    .post(format!("{}/responses", oauth::RESOURCE))
    .bearer_auth(&token)
    .json(&body)
    .send()
    .await
    .map_err(|error| format!("Couldn't reach ChatGPT: {error}"))?;
  let status = response.status().as_u16();
  if !(200..300).contains(&status) {
    let body = response.text().await.unwrap_or_default();
    return Err(responses::http_error(status, &body));
  }
  let mut reader = StreamReader::default();
  // Bytes of a UTF-8 character split across chunks.
  let mut pending: Vec<u8> = Vec::new();
  loop {
    let chunk = response
      .chunk()
      .await
      .map_err(|_| ChatGptError::with_code("stream_interrupted", "The connection to ChatGPT was lost."))?;
    let Some(chunk) = chunk else {
      break;
    };
    pending.extend_from_slice(&chunk);
    let valid = match std::str::from_utf8(&pending) {
      Ok(text) => text.len(),
      Err(error) => error.valid_up_to(),
    };
    let text = String::from_utf8_lossy(&pending[..valid]).into_owned();
    pending.drain(..valid);
    if reader.push(&text) {
      break;
    }
  }
  reader.finish()
}
