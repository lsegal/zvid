// Reading a streamed Responses API reply through to its terminal event. See
// https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference.
use serde::Serialize;
use serde_json::Value;

// An error the webview can act on: `code` is the API's machine-readable code
// when it sent one, such as `subscription_sharing_usage_limit_exceeded`.
#[derive(Serialize, Debug, PartialEq)]
pub struct ChatGptError {
  pub code: Option<String>,
  pub message: String,
}

impl ChatGptError {
  pub fn new(message: impl Into<String>) -> Self {
    Self {
      code: None,
      message: message.into(),
    }
  }

  pub fn with_code(code: &str, message: impl Into<String>) -> Self {
    Self {
      code: Some(code.to_string()),
      message: message.into(),
    }
  }
}

impl From<String> for ChatGptError {
  fn from(message: String) -> Self {
    Self::new(message)
  }
}

impl From<&str> for ChatGptError {
  fn from(message: &str) -> Self {
    Self::new(message)
  }
}

fn error_from(value: &Value, fallback: &str) -> ChatGptError {
  let code = value.get("code").and_then(Value::as_str);
  let message = value
    .get("message")
    .and_then(Value::as_str)
    .unwrap_or(fallback)
    .to_string();
  match code {
    Some(code) => ChatGptError::with_code(code, message),
    None => ChatGptError::new(message),
  }
}

// The error for a request refused before its stream opened. Its body may be
// an API `error` object or just `{"detail": ...}`.
pub fn http_error(status: u16, body: &str) -> ChatGptError {
  let parsed: Value = serde_json::from_str(body).unwrap_or(Value::Null);
  if let Some(error) = parsed.get("error").filter(|error| error.is_object()) {
    return error_from(error, &format!("ChatGPT request failed ({status})."));
  }
  let detail = parsed.get("detail").and_then(Value::as_str);
  let message = match (status, detail) {
    (401, _) => "ChatGPT didn't accept the sign-in. Sign in again.".to_string(),
    (_, Some(detail)) => format!("ChatGPT request failed ({status}): {detail}"),
    _ => format!("ChatGPT request failed ({status})."),
  };
  ChatGptError::with_code(&format!("http_{status}"), message)
}

// Collects server-sent events until `response.completed`, whose response
// object is the result.
#[derive(Default)]
pub struct StreamReader {
  buffer: String,
  outcome: Option<Result<Value, ChatGptError>>,
}

impl StreamReader {
  // Feeds received text; returns true once a terminal event arrived.
  pub fn push(&mut self, chunk: &str) -> bool {
    self.buffer.push_str(&chunk.replace("\r\n", "\n"));
    while self.outcome.is_none() {
      let Some(end) = self.buffer.find("\n\n") else {
        break;
      };
      let event: String = self.buffer.drain(..end + 2).collect();
      self.read_event(&event);
    }
    self.outcome.is_some()
  }

  fn read_event(&mut self, event: &str) {
    let data: Vec<&str> = event
      .lines()
      .filter_map(|line| line.strip_prefix("data:"))
      .map(str::trim_start)
      .collect();
    if data.is_empty() {
      return;
    }
    let Ok(value) = serde_json::from_str::<Value>(&data.join("\n")) else {
      return;
    };
    let response = value.get("response").cloned().unwrap_or(Value::Null);
    self.outcome = match value.get("type").and_then(Value::as_str) {
      Some("response.completed") => Some(Ok(response)),
      Some("response.failed") => Some(Err(error_from(
        response.get("error").unwrap_or(&Value::Null),
        "ChatGPT couldn't complete the request.",
      ))),
      Some("response.incomplete") => {
        let reason = response
          .pointer("/incomplete_details/reason")
          .and_then(Value::as_str)
          .unwrap_or("unknown");
        Some(Err(ChatGptError::with_code(
          "response_incomplete",
          format!("ChatGPT stopped before finishing ({reason})."),
        )))
      }
      Some("error") => Some(Err(error_from(
        value.get("error").unwrap_or(&value),
        "ChatGPT reported an error.",
      ))),
      _ => None,
    };
  }

  pub fn finish(mut self) -> Result<Value, ChatGptError> {
    if self.outcome.is_none() && !self.buffer.trim().is_empty() {
      let rest = std::mem::take(&mut self.buffer);
      self.read_event(&format!("{rest}\n\n"));
    }
    self.outcome.unwrap_or_else(|| {
      Err(ChatGptError::with_code(
        "stream_interrupted",
        "The connection to ChatGPT closed before the reply finished.",
      ))
    })
  }
}

// The first model the account lists for display, from `GET /v1/models`.
pub fn first_listed_model(catalog: &Value) -> Option<String> {
  catalog
    .get("models")?
    .as_array()?
    .iter()
    .find(|model| model.get("visibility").and_then(Value::as_str) == Some("list"))?
    .get("slug")?
    .as_str()
    .map(str::to_string)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn returns_the_completed_response_across_chunks() {
    let mut reader = StreamReader::default();
    assert!(!reader.push("event: response.created\ndata: {\"type\":\"response.created\"}\n\n"));
    assert!(!reader.push("data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hi\"}\r\n\r\ndata: {\"type\":\"response.comp"));
    assert!(reader.push("leted\",\"response\":{\"id\":\"r1\",\"output\":[]}}\n\n"));
    assert_eq!(reader.finish().unwrap(), json!({"id": "r1", "output": []}));
  }

  #[test]
  fn reports_failed_and_interrupted_streams() {
    let mut failed = StreamReader::default();
    failed.push(
      "data: {\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"subscription_sharing_usage_limit_exceeded\",\"message\":\"Limit reached\"}}}\n\n",
    );
    assert_eq!(
      failed.finish().unwrap_err(),
      ChatGptError::with_code("subscription_sharing_usage_limit_exceeded", "Limit reached")
    );

    let mut cut = StreamReader::default();
    cut.push("data: {\"type\":\"response.output_text.delta\",\"delta\":\"Hi\"}\n\n");
    assert_eq!(cut.finish().unwrap_err().code.as_deref(), Some("stream_interrupted"));

    let mut incomplete = StreamReader::default();
    incomplete.push("data: {\"type\":\"response.incomplete\",\"response\":{\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}");
    assert!(incomplete.finish().unwrap_err().message.contains("max_output_tokens"));
  }

  #[test]
  fn reads_errors_before_the_stream_opens() {
    let api = http_error(429, r#"{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Limit"}}"#);
    assert_eq!(api.code.as_deref(), Some("subscription_sharing_usage_limit_exceeded"));
    let admission = http_error(503, r#"{"detail":"Direct routing unavailable"}"#);
    assert_eq!(admission.code.as_deref(), Some("http_503"));
    assert!(admission.message.contains("Direct routing unavailable"));
    assert_eq!(http_error(401, "").code.as_deref(), Some("http_401"));
  }

  #[test]
  fn picks_the_first_listed_model() {
    let catalog = json!({"models": [
      {"slug": "hidden", "visibility": "hide"},
      {"slug": "gpt-a", "visibility": "list"},
      {"slug": "gpt-b", "visibility": "list"}
    ]});
    assert_eq!(first_listed_model(&catalog).as_deref(), Some("gpt-a"));
    assert_eq!(first_listed_model(&json!({"models": []})), None);
  }
}
