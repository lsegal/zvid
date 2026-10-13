// The installation's host ID and its saved ChatGPT connection, kept in the
// app's config folder in owner-only files so they survive restarts.
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

const HOST_FILE: &str = "chatgpt-host.json";
const AUTH_FILE: &str = "chatgpt-auth.json";

#[derive(Serialize, Deserialize)]
struct HostRecord {
  ext_agent_host_id: String,
}

// One registration: its issued client ID and verified identity, plus
// tokens while signed in. Signing out clears the tokens but keeps the
// registration, so signing in again reuses the same client.
#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Debug)]
pub struct Credentials {
  pub client_id: String,
  pub subject: String,
  pub email: Option<String>,
  pub id_token: Option<String>,
  pub access_token: Option<String>,
  pub refresh_token: Option<String>,
  // Unix seconds when the access token expires.
  pub expires_at: u64,
  pub scopes: Vec<String>,
}

impl Credentials {
  pub fn signed_in(&self) -> bool {
    self.access_token.is_some() && self.refresh_token.is_some()
  }

  pub fn plan_usage(&self) -> bool {
    self.signed_in() && self.scopes.iter().any(|scope| scope == super::oauth::PLAN_USAGE_SCOPE)
  }

  pub fn sign_out(&mut self) {
    self.access_token = None;
    self.refresh_token = None;
    self.expires_at = 0;
  }
}

pub struct Store {
  dir: PathBuf,
}

impl Store {
  pub fn new(dir: PathBuf) -> Self {
    Self { dir }
  }

  // The saved host ID, creating one on first use.
  pub fn host_id(&self) -> Result<String, String> {
    if let Some(record) = read_json::<HostRecord>(&self.dir.join(HOST_FILE)) {
      return Ok(record.ext_agent_host_id);
    }
    let record = HostRecord {
      ext_agent_host_id: super::oauth::new_host_id()?,
    };
    write_private(&self.dir, HOST_FILE, &record)?;
    Ok(record.ext_agent_host_id)
  }

  pub fn credentials(&self) -> Option<Credentials> {
    read_json(&self.dir.join(AUTH_FILE))
  }

  pub fn save(&self, credentials: &Credentials) -> Result<(), String> {
    write_private(&self.dir, AUTH_FILE, credentials)
  }
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
  serde_json::from_str(&fs::read_to_string(path).ok()?).ok()
}

// Writes atomically through a temporary file, readable only by the user.
fn write_private<T: Serialize>(dir: &Path, name: &str, value: &T) -> Result<(), String> {
  let fail = |error: std::io::Error| format!("Failed to save ChatGPT sign-in: {error}");
  fs::create_dir_all(dir).map_err(fail)?;
  let json = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
  let mut file = tempfile::NamedTempFile::new_in(dir).map_err(fail)?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    file
      .as_file()
      .set_permissions(fs::Permissions::from_mode(0o600))
      .map_err(fail)?;
  }
  file.write_all(&json).map_err(fail)?;
  file.persist(dir.join(name)).map_err(|error| fail(error.error))?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn keeps_the_host_id_across_restarts() {
    let dir = tempfile::tempdir().unwrap();
    let first = Store::new(dir.path().to_path_buf()).host_id().unwrap();
    let again = Store::new(dir.path().to_path_buf()).host_id().unwrap();
    assert_eq!(first, again);
  }

  #[test]
  fn saves_credentials_privately() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::new(dir.path().join("nested"));
    assert!(store.credentials().is_none());
    let credentials = Credentials {
      client_id: "oaiapp_1".into(),
      subject: "user-1".into(),
      access_token: Some("access".into()),
      refresh_token: Some("refresh".into()),
      scopes: vec!["chatgpt.tokens.use.direct".into()],
      ..Credentials::default()
    };
    store.save(&credentials).unwrap();
    assert_eq!(store.credentials(), Some(credentials));
    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mode = fs::metadata(dir.path().join("nested").join(AUTH_FILE))
        .unwrap()
        .permissions()
        .mode();
      assert_eq!(mode & 0o777, 0o600);
    }
  }

  #[test]
  fn signing_out_keeps_the_registration() {
    let mut credentials = Credentials {
      client_id: "oaiapp_1".into(),
      access_token: Some("access".into()),
      refresh_token: Some("refresh".into()),
      scopes: vec!["chatgpt.tokens.use.direct".into()],
      ..Credentials::default()
    };
    assert!(credentials.plan_usage());
    credentials.sign_out();
    assert!(!credentials.signed_in());
    assert!(!credentials.plan_usage());
    assert_eq!(credentials.client_id, "oaiapp_1");
  }
}
