use std::path::PathBuf;
use std::sync::mpsc;

use zvid_daw_core::{RecordRoot, State};

use super::*;
use crate::mock::MockBackend;

struct Fixture {
    dir: PathBuf,
    backend: Arc<MockBackend>,
    protocol: Arc<Protocol>,
    revealed: Arc<Mutex<Vec<PathBuf>>>,
    desktop: Arc<RecordingDesktop>,
}

#[derive(Default)]
struct RecordingDesktop {
    revealed: Arc<Mutex<Vec<PathBuf>>>,
    settings_opened: AtomicBool,
}

impl Desktop for RecordingDesktop {
    fn reveal(&self, path: &Path) -> std::io::Result<()> {
        self.revealed.lock().unwrap().push(path.to_path_buf());
        Ok(())
    }

    fn open_camera_privacy_settings(&self) -> std::io::Result<()> {
        self.settings_opened.store(true, Ordering::Release);
        Ok(())
    }
}

impl Fixture {
    fn new(name: &str) -> Self {
        let dir =
            std::env::temp_dir().join(format!("zvid-ui-protocol-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let root = RecordRoot::resolve_with(Some(&dir), None).unwrap();
        std::fs::create_dir_all(&root.dir).unwrap();
        crate::poster::write_test_clip(&root.path_of("clip.mp4"), 64, 36, 12, 10).unwrap();
        let backend = Arc::new(MockBackend::new(
            root,
            State::default(),
            Some("clip.mp4".into()),
        ));
        let desktop = Arc::new(RecordingDesktop::default());
        let revealed = desktop.revealed.clone();
        let protocol = Arc::new(Protocol::new(
            backend.clone(),
            Arc::new(PosterCache::default()),
            desktop.clone(),
        ));
        Self {
            dir,
            backend,
            protocol,
            revealed,
            desktop,
        }
    }

    fn send(&self, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
        let (sender, receiver) = mpsc::channel();
        self.protocol.handle(
            request,
            Box::new(move |response| sender.send(response).unwrap()),
        );
        receiver.recv_timeout(Duration::from_secs(30)).unwrap()
    }

    fn get(&self, uri: &str) -> Response<Vec<u8>> {
        self.send(Request::get(uri).body(Vec::new()).unwrap())
    }

    fn invoke(&self, command: &str, args: Value) -> Response<Vec<u8>> {
        self.send(
            Request::post(format!("zvid://ipc/{command}"))
                .body(args.to_string().into_bytes())
                .unwrap(),
        )
    }

    /// Records a take pointing at the fixture clip and returns its ID.
    fn record_take(&self) -> String {
        self.backend.select_camera("mock-builtin").unwrap();
        self.backend.arm().unwrap();
        self.backend.set_playing(true);
        self.backend.set_playing(false);
        self.backend.disarm().unwrap();
        self.backend.takes()[0].id.clone()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

fn body_json(response: &Response<Vec<u8>>) -> Value {
    serde_json::from_slice(response.body()).unwrap()
}

#[test]
fn parses_both_url_forms() {
    let uri = |text: &str| text.parse::<http::Uri>().unwrap();
    assert_eq!(
        split_uri(&uri("zvid://take/abc%20d")),
        Some(("take".into(), "abc d".into()))
    );
    assert_eq!(
        split_uri(&uri("https://zvid.app/assets/x.js")),
        Some(("app".into(), "assets/x.js".into()))
    );
    assert_eq!(
        split_uri(&uri("http://zvid.ipc/events?after=3")),
        Some(("ipc".into(), "events".into()))
    );
    assert_eq!(split_uri(&uri("https://example.com/")), None);
    assert_eq!(split_uri(&uri("zvid://take/%zz")), None);
    assert_eq!(query_param("a=1&after=42", "after"), Some("42"));
    assert_eq!(query_param("", "after"), None);
}

#[test]
fn origins_match_the_platform() {
    if cfg!(windows) {
        assert_eq!(origin("app"), "https://zvid.app");
    } else {
        assert_eq!(origin("app"), "zvid://app");
    }
}

#[test]
fn serves_the_app() {
    let fixture = Fixture::new("app");
    let response = fixture.get("zvid://app/");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/html; charset=utf-8"
    );
    assert_eq!(
        fixture.get("zvid://app/nope.js").status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        fixture.get("zvid://nowhere/").status(),
        StatusCode::NOT_FOUND
    );
    let preflight = fixture.send(
        Request::builder()
            .method(Method::OPTIONS)
            .uri("zvid://ipc/arm")
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(preflight.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        preflight.headers()[header::ACCESS_CONTROL_ALLOW_ORIGIN],
        "*"
    );
}

#[test]
fn runs_commands() {
    let fixture = Fixture::new("commands");
    let cameras = body_json(&fixture.invoke("listCameras", Value::Null));
    assert_eq!(cameras[0]["name"], "FaceTime HD Camera");
    assert_eq!(
        body_json(&fixture.invoke("getStatus", Value::Null))["phase"],
        "noCamera"
    );

    let response = fixture.invoke("selectCamera", serde_json::json!({ "id": "mock-builtin" }));
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(fixture.invoke("arm", Value::Null).status(), StatusCode::OK);
    assert_eq!(
        body_json(&fixture.invoke("getStatus", Value::Null))["phase"],
        "capturing"
    );
    assert_eq!(
        fixture.invoke("disarm", Value::Null).status(),
        StatusCode::OK
    );
    let takes = body_json(&fixture.invoke("listTakes", Value::Null));
    assert_eq!(takes.as_array().unwrap().len(), 1);
    assert_eq!(takes[0]["unanchored"], true);
    assert_eq!(takes[0]["missing"], false);

    let refreshed = body_json(&fixture.invoke("refreshDevices", Value::Null));
    assert_eq!(
        refreshed.as_array().unwrap().len(),
        cameras.as_array().unwrap().len() + 1
    );
}

#[test]
fn reports_command_errors() {
    let fixture = Fixture::new("errors");
    let response = fixture.invoke("selectCamera", serde_json::json!({}));
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(body_json(&response)["code"], "invalidRequest");

    let response = fixture.invoke("selectCamera", serde_json::json!({ "id": "mock-denied" }));
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(body_json(&response)["code"], "permissionDenied");

    let response = fixture.invoke("revealTake", serde_json::json!({ "id": "missing" }));
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        fixture.invoke("launchRockets", Value::Null).status(),
        StatusCode::BAD_REQUEST
    );
}

#[test]
fn reveals_takes() {
    let fixture = Fixture::new("reveal");
    let id = fixture.record_take();
    let response = fixture.invoke("revealTake", serde_json::json!({ "id": id }));
    assert_eq!(response.status(), StatusCode::OK);
    let revealed = fixture.revealed.lock().unwrap().clone();
    assert_eq!(revealed.len(), 1);
    assert!(revealed[0].ends_with("clip.mp4"));

    let response = fixture.invoke("openPrivacySettings", Value::Null);
    assert_eq!(response.status(), StatusCode::OK);
    assert!(fixture.desktop.settings_opened.load(Ordering::Acquire));
}

#[test]
fn long_polls_events() {
    let fixture = Fixture::new("events");
    let joined = body_json(&fixture.get("zvid://ipc/events"));
    let cursor = joined["cursor"].as_u64().unwrap();

    let backend = fixture.backend.clone();
    let producer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        backend.select_camera("mock-usb").unwrap();
    });
    let batch = body_json(&fixture.get(&format!("zvid://ipc/events?after={cursor}")));
    producer.join().unwrap();
    assert!(batch["cursor"].as_u64().unwrap() > cursor);
    assert_eq!(batch["events"][0]["event"], "status");
    assert_eq!(batch["events"][0]["payload"]["phase"], "ready");
}

#[test]
fn long_polls_preview_frames() {
    let fixture = Fixture::new("preview");
    assert_eq!(
        fixture.get("zvid://preview").status(),
        StatusCode::NO_CONTENT
    );
    fixture.backend.select_camera("mock-builtin").unwrap();
    fixture.backend.publish_frame();

    let response = fixture.get("zvid://preview");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
    let seq: u64 = response.headers()["X-Frame-Seq"]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();

    let backend = fixture.backend.clone();
    let producer = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        backend.publish_frame();
    });
    let next = fixture.get(&format!("zvid://preview/frame?after={seq}"));
    producer.join().unwrap();
    assert_eq!(next.status(), StatusCode::OK);
    assert_eq!(
        next.headers()["X-Frame-Seq"],
        (seq + 1).to_string().as_str()
    );
    assert_eq!(&next.body()[..2], &[0xFF, 0xD8]);
}

#[test]
fn shutdown_ends_open_polls() {
    let fixture = Fixture::new("shutdown");
    let (sender, receiver) = mpsc::channel();
    fixture.protocol.handle(
        Request::get("zvid://preview/frame?after=0")
            .body(Vec::new())
            .unwrap(),
        Box::new(move |response| sender.send(response).unwrap()),
    );
    std::thread::sleep(Duration::from_millis(50));
    let started = Instant::now();
    fixture.protocol.shutdown();
    let response = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(
        fixture.get("zvid://ipc/events").status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
}

#[test]
fn streams_takes_with_ranges() {
    let fixture = Fixture::new("take");
    let id = fixture.record_take();
    let file = fixture.backend.take_file(&id).unwrap();
    let bytes = std::fs::read(&file.path).unwrap();
    let total = bytes.len();

    let whole = fixture.get(&format!("zvid://take/{id}"));
    assert_eq!(whole.status(), StatusCode::OK);
    assert_eq!(whole.headers()[header::CONTENT_TYPE], "video/mp4");
    assert_eq!(whole.headers()[header::ACCEPT_RANGES], "bytes");
    assert_eq!(whole.body(), &bytes);

    let part = fixture.send(
        Request::get(format!("zvid://take/{id}"))
            .header(header::RANGE, "bytes=4-11")
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(part.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        part.headers()[header::CONTENT_RANGE],
        format!("bytes 4-11/{total}").as_str()
    );
    assert_eq!(part.body(), &bytes[4..12]);

    let past_end = fixture.send(
        Request::get(format!("zvid://take/{id}"))
            .header(header::RANGE, format!("bytes={total}-"))
            .body(Vec::new())
            .unwrap(),
    );
    assert_eq!(past_end.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    assert_eq!(
        fixture.get("zvid://take/unknown").status(),
        StatusCode::NOT_FOUND
    );
}

#[test]
fn serves_poster_thumbnails() {
    let fixture = Fixture::new("thumb");
    let id = fixture.record_take();
    let response = fixture.get(&format!("zvid://thumb/{id}"));
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "image/jpeg");
    assert_eq!(&response.body()[..2], &[0xFF, 0xD8]);
    // Served from the cache the second time.
    assert_eq!(
        fixture.get(&format!("zvid://thumb/{id}")).body(),
        response.body()
    );
    assert_eq!(
        fixture.get("zvid://thumb/unknown").status(),
        StatusCode::NOT_FOUND
    );

    std::fs::remove_file(fixture.backend.take_file(&id).unwrap().path).unwrap();
    assert_eq!(
        fixture.get(&format!("zvid://thumb/{id}")).status(),
        StatusCode::NOT_FOUND
    );
    let response = fixture.invoke("revealTake", serde_json::json!({ "id": id }));
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(fixture.revealed.lock().unwrap().is_empty());
}

#[test]
fn serves_decoded_take_frames() {
    let fixture = Fixture::new("frames");
    let id = fixture.record_take();
    let frame = |t: &str| fixture.get(&format!("zvid://frames/{id}?t={t}"));
    let first = frame("0");
    assert_eq!(first.status(), StatusCode::OK);
    assert_eq!(first.headers()[header::CONTENT_TYPE], "image/jpeg");
    assert_eq!(first.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(&first.body()[..2], &[0xFF, 0xD8]);
    // Later frames continue the open decoder; earlier ones start over.
    let later = frame("0.5");
    assert_eq!(later.status(), StatusCode::OK);
    assert_ne!(later.body(), first.body());
    assert_eq!(frame("0").body(), first.body());

    assert_eq!(
        fixture.get(&format!("zvid://frames/{id}")).status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(frame("NaN").status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        fixture.get("zvid://frames/unknown?t=0").status(),
        StatusCode::NOT_FOUND
    );
    std::fs::remove_file(fixture.backend.take_file(&id).unwrap().path).unwrap();
    assert_eq!(frame("0.2").status(), StatusCode::NOT_FOUND);
}
