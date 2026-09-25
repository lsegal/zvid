//! The `zvid://` custom protocol.
//!
//! | URL                             | Serves                                         |
//! |---------------------------------|------------------------------------------------|
//! | `zvid://app/*`                  | the embedded frontend                          |
//! | `zvid://ipc/<command>` (POST)   | a command, modelled on Tauri `invoke`          |
//! | `zvid://ipc/events?after=N`     | long-polled events, modelled on Tauri `emit`   |
//! | `zvid://preview`                | the latest preview JPEG                        |
//! | `zvid://preview/frame?after=N`  | the next preview JPEG, long-polled             |
//! | `zvid://take/<id>`              | the take's file, with HTTP `Range` support     |
//! | `zvid://thumb/<id>`             | the take's poster frame as JPEG                |
//!
//! wry buffers each custom-protocol response, so the preview is delivered as
//! one long-polled JPEG per request instead of a multipart MJPEG stream; the
//! frontend asks for the next frame as soon as it has drawn the last one.
//!
//! On Windows WebView2 reaches `zvid://<host>/` as `https://zvid.<host>/`;
//! [`origin`] gives the right form for the running platform.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime};

use http::{Method, Request, Response, StatusCode, header};
use serde::Deserialize;
use serde_json::Value;

use crate::assets;
use crate::backend::Backend;
use crate::channels::Cancel;
use crate::model::{ErrorCode, UiError};
use crate::poster::{POSTER_EDGE, poster_jpeg};
use crate::range::{self, ByteRange, RangeRequest};

/// Scheme registered with the webview.
pub const SCHEME: &str = "zvid";
/// How long a long-poll waits before answering with nothing new.
pub const POLL_TIMEOUT: Duration = Duration::from_secs(20);
/// Longest [`Protocol::shutdown`] waits for in-flight requests.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(2);

/// The origin a route is reachable at from inside the webview.
pub fn origin(host: &str) -> String {
    if cfg!(windows) {
        format!("https://{SCHEME}.{host}")
    } else {
        format!("{SCHEME}://{host}")
    }
}

/// Sends the response for one request; may be called from any thread.
pub type Responder = Box<dyn FnOnce(Response<Vec<u8>>) + Send>;
/// Reveals a file in Finder or Explorer.
pub type Reveal = Arc<dyn Fn(&Path) -> std::io::Result<()> + Send + Sync>;

/// Poster JPEGs by file, offset and modification time, shared by every
/// editor in the process.
#[derive(Default)]
pub struct PosterCache {
    entries: Mutex<HashMap<PosterKey, Arc<[u8]>>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct PosterKey {
    path: PathBuf,
    offset_bits: u64,
    len: u64,
    modified: Option<SystemTime>,
}

/// Posters kept before the cache starts over.
const POSTER_CACHE_LIMIT: usize = 128;

impl PosterCache {
    fn get_or_decode(&self, path: &Path, offset_sec: f64) -> Result<Arc<[u8]>, UiError> {
        let metadata = std::fs::metadata(path)
            .map_err(|_| UiError::new(ErrorCode::NotFound, "the take's file is missing"))?;
        let key = PosterKey {
            path: path.to_path_buf(),
            offset_bits: offset_sec.to_bits(),
            len: metadata.len(),
            modified: metadata.modified().ok(),
        };
        if let Some(jpeg) = lock(&self.entries).get(&key) {
            return Ok(jpeg.clone());
        }
        let jpeg: Arc<[u8]> = poster_jpeg(path, offset_sec, POSTER_EDGE)
            .map_err(|error| UiError::new(ErrorCode::Internal, error.to_string()))?
            .into();
        let mut entries = lock(&self.entries);
        if entries.len() >= POSTER_CACHE_LIMIT {
            entries.clear();
        }
        entries.insert(key, jpeg.clone());
        Ok(jpeg)
    }
}

/// Counts requests still being answered so shutdown can wait for them.
#[derive(Default)]
struct InFlight {
    count: Mutex<usize>,
    idle: Condvar,
}

/// One editor's protocol handler.
pub struct Protocol {
    backend: Arc<dyn Backend>,
    posters: Arc<PosterCache>,
    reveal: Reveal,
    cancel: Cancel,
    in_flight: Arc<InFlight>,
}

impl Protocol {
    pub fn new(backend: Arc<dyn Backend>, posters: Arc<PosterCache>, reveal: Reveal) -> Self {
        Self {
            backend,
            posters,
            reveal,
            cancel: Arc::new(AtomicBool::new(false)),
            in_flight: Arc::default(),
        }
    }

    /// Answers one request. Anything that may block runs on its own thread.
    pub fn handle(self: &Arc<Self>, request: Request<Vec<u8>>, respond: Responder) {
        if self.cancel.load(Ordering::Acquire) {
            respond(plain(StatusCode::SERVICE_UNAVAILABLE, "editor closed"));
            return;
        }
        let Some((host, path)) = split_uri(request.uri()) else {
            respond(plain(StatusCode::NOT_FOUND, "unknown URL"));
            return;
        };
        if request.method() == Method::OPTIONS {
            respond(preflight());
            return;
        }
        if host == "app" {
            respond(app(&path));
            return;
        }
        let this = self.clone();
        self.in_flight.enter();
        std::thread::Builder::new()
            .name(format!("zvid-ui-{host}"))
            .spawn(move || {
                let response = this.route(&host, &path, &request);
                respond(response);
                this.in_flight.leave();
            })
            .expect("spawning a protocol worker succeeds");
    }

    fn route(&self, host: &str, path: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        let query = request.uri().query().unwrap_or("");
        match (host, request.method(), path) {
            ("ipc", &Method::GET, "events") => {
                let after = query_param(query, "after").and_then(|after| after.parse().ok());
                let batch = self
                    .backend
                    .channels()
                    .events
                    .poll(after, POLL_TIMEOUT, &self.cancel);
                json(StatusCode::OK, batch.to_json())
            }
            ("ipc", &Method::POST, command) => match self.invoke(command, request.body()) {
                Ok(value) => json(StatusCode::OK, value.to_string()),
                Err(error) => error_response(&error),
            },
            ("preview", &Method::GET, "") => match self.backend.channels().preview.latest() {
                Some(frame) => jpeg(frame.jpeg.to_vec(), Some(frame.seq)),
                None => empty(StatusCode::NO_CONTENT),
            },
            ("preview", &Method::GET, "frame") => {
                let after = query_param(query, "after")
                    .and_then(|after| after.parse().ok())
                    .unwrap_or(0);
                match self
                    .backend
                    .channels()
                    .preview
                    .poll(after, POLL_TIMEOUT, &self.cancel)
                {
                    Some(frame) => jpeg(frame.jpeg.to_vec(), Some(frame.seq)),
                    None => empty(StatusCode::NO_CONTENT),
                }
            }
            ("take", &Method::GET, id) => match self.backend.take_file(id) {
                Some(file) => serve_file(&file.path, request.headers().get(header::RANGE)),
                None => plain(StatusCode::NOT_FOUND, "unknown take"),
            },
            ("thumb", &Method::GET, id) => match self.backend.take_file(id) {
                Some(file) => match self.posters.get_or_decode(&file.path, file.file_offset_sec) {
                    Ok(bytes) => jpeg(bytes.to_vec(), None),
                    Err(error) => error_response(&error),
                },
                None => plain(StatusCode::NOT_FOUND, "unknown take"),
            },
            _ => plain(StatusCode::NOT_FOUND, "unknown URL"),
        }
    }

    /// Runs an IPC command with its JSON arguments.
    pub fn invoke(&self, command: &str, body: &[u8]) -> Result<Value, UiError> {
        #[derive(Deserialize)]
        struct IdArgs {
            id: String,
        }
        let id = || -> Result<String, UiError> {
            serde_json::from_slice::<IdArgs>(body)
                .map(|args| args.id)
                .map_err(|error| {
                    UiError::new(
                        ErrorCode::InvalidRequest,
                        format!("{command} needs {{\"id\": string}}: {error}"),
                    )
                })
        };
        let backend = &self.backend;
        match command {
            "getStatus" => to_value(backend.status()),
            "listCameras" => to_value(backend.cameras()),
            "selectCamera" => backend.select_camera(&id()?).map(|()| Value::Null),
            "refreshDevices" => backend.refresh_devices().and_then(to_value),
            "arm" => backend.arm().map(|()| Value::Null),
            "disarm" => backend.disarm().map(|()| Value::Null),
            "listTakes" => to_value(backend.takes()),
            "revealTake" => {
                let file = backend
                    .take_file(&id()?)
                    .ok_or_else(|| UiError::new(ErrorCode::NotFound, "unknown take"))?;
                if !file.path.is_file() {
                    return Err(UiError::new(
                        ErrorCode::NotFound,
                        "the take's file is missing",
                    ));
                }
                (self.reveal)(&file.path).map_err(|error| {
                    UiError::new(
                        ErrorCode::Internal,
                        format!("couldn't reveal the file: {error}"),
                    )
                })?;
                Ok(Value::Null)
            }
            _ => Err(UiError::new(
                ErrorCode::InvalidRequest,
                format!("unknown command {command}"),
            )),
        }
    }

    /// Ends every long-poll this editor has open and waits briefly for
    /// in-flight requests to answer. Later requests get 503.
    pub fn shutdown(&self) {
        self.cancel.store(true, Ordering::Release);
        self.backend.channels().wake_all();
        self.in_flight.wait_idle(SHUTDOWN_GRACE);
    }
}

impl InFlight {
    fn enter(&self) {
        *lock(&self.count) += 1;
    }

    fn leave(&self) {
        let mut count = lock(&self.count);
        *count -= 1;
        if *count == 0 {
            self.idle.notify_all();
        }
    }

    fn wait_idle(&self, grace: Duration) {
        let deadline = Instant::now() + grace;
        let mut count = lock(&self.count);
        while *count > 0 {
            let now = Instant::now();
            if now >= deadline {
                return;
            }
            count = self
                .idle
                .wait_timeout(count, deadline - now)
                .unwrap_or_else(|error| error.into_inner())
                .0;
        }
    }
}

/// `(host, path)` of a `zvid://host/path` URL, also accepting WebView2's
/// `http(s)://zvid.host/path` form.
fn split_uri(uri: &http::Uri) -> Option<(String, String)> {
    let host = uri.host()?;
    let host = match uri.scheme_str()? {
        SCHEME => host,
        "http" | "https" => host.strip_prefix("zvid.")?,
        _ => return None,
    };
    let path = uri.path().trim_matches('/');
    let path = percent_decode(path)?;
    Some((host.to_ascii_lowercase(), path))
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

fn query_param<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
}

fn app(path: &str) -> Response<Vec<u8>> {
    match assets::asset(path) {
        Some(asset) => base(StatusCode::OK)
            .header(header::CONTENT_TYPE, asset.mime)
            .header(
                header::CACHE_CONTROL,
                if asset.mime.starts_with("text/html") {
                    "no-cache"
                } else {
                    "max-age=31536000, immutable"
                },
            )
            .body(asset.bytes.to_vec())
            .expect("valid response"),
        None => plain(StatusCode::NOT_FOUND, "no such asset"),
    }
}

fn serve_file(path: &Path, range_header: Option<&header::HeaderValue>) -> Response<Vec<u8>> {
    let Ok(mut file) = File::open(path) else {
        return plain(StatusCode::NOT_FOUND, "the take's file is missing");
    };
    let total = file.metadata().map(|metadata| metadata.len()).unwrap_or(0);
    let request = range::resolve(range_header.and_then(|value| value.to_str().ok()), total);
    // A plain request for a large file is answered with its first chunk as
    // a 206 as well, so memory stays bounded; media elements follow up with
    // ranges.
    let range = match request {
        RangeRequest::Unsatisfiable => {
            return base(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{total}"))
                .body(Vec::new())
                .expect("valid response");
        }
        RangeRequest::Partial(range) => Some(range),
        RangeRequest::Full if total > range::MAX_CHUNK => Some(ByteRange {
            start: 0,
            end: range::MAX_CHUNK - 1,
        }),
        RangeRequest::Full => None,
    };
    let (start, len) = range.map_or((0, total), |range| (range.start, range.len()));
    let mut body = vec![0_u8; len as usize];
    let read = file
        .seek(SeekFrom::Start(start))
        .and_then(|_| file.read_exact(&mut body));
    if read.is_err() {
        return plain(StatusCode::INTERNAL_SERVER_ERROR, "couldn't read the take");
    }
    let mut builder = base(if range.is_some() {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    })
    .header(
        header::CONTENT_TYPE,
        assets::mime_for(&path.to_string_lossy()),
    )
    .header(header::ACCEPT_RANGES, "bytes")
    .header(header::CONTENT_LENGTH, len);
    if let Some(range) = range {
        builder = builder.header(header::CONTENT_RANGE, range.content_range(total));
    }
    builder.body(body).expect("valid response")
}

fn to_value(value: impl serde::Serialize) -> Result<Value, UiError> {
    serde_json::to_value(value)
        .map_err(|error| UiError::new(ErrorCode::Internal, error.to_string()))
}

fn base(status: StatusCode) -> http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "X-Frame-Seq, Content-Range",
        )
}

fn preflight() -> Response<Vec<u8>> {
    base(StatusCode::NO_CONTENT)
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, POST, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Content-Type, Range")
        .body(Vec::new())
        .expect("valid response")
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    base(status)
        .header(header::CACHE_CONTROL, "no-store")
        .body(Vec::new())
        .expect("valid response")
}

fn plain(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    base(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(message.as_bytes().to_vec())
        .expect("valid response")
}

fn json(status: StatusCode, body: String) -> Response<Vec<u8>> {
    base(status)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(body.into_bytes())
        .expect("valid response")
}

fn jpeg(bytes: Vec<u8>, seq: Option<u64>) -> Response<Vec<u8>> {
    let mut builder = base(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "no-store");
    if let Some(seq) = seq {
        builder = builder.header("X-Frame-Seq", seq);
    }
    builder.body(bytes).expect("valid response")
}

fn error_response(error: &UiError) -> Response<Vec<u8>> {
    let status = match error.code {
        ErrorCode::InvalidRequest => StatusCode::BAD_REQUEST,
        ErrorCode::NotFound => StatusCode::NOT_FOUND,
        ErrorCode::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::CONFLICT,
    };
    json(
        status,
        serde_json::to_string(error).expect("errors serialize"),
    )
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
mod tests;
