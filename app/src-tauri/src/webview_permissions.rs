// Grants the app's own page WebView2's MIDI permission, so turning MIDI on
// never shows the browser-style prompt naming http://tauri.localhost. WebView2
// reports Web MIDI as its system-exclusive permission kind even though the app
// only reads input. Other webviews have no such prompt: the native backend in
// midi.rs reads MIDI there. Pages from any other origin still get the prompt.

use url::Url;

// Where Tauri serves the built frontend on Windows.
#[cfg(windows)]
const BUILT_ORIGIN: &str = "http://tauri.localhost";

fn has_origin(uri: &str, origin: &str) -> bool {
  Url::parse(uri).is_ok_and(|uri| uri.origin().ascii_serialization() == origin)
}

#[cfg(windows)]
fn app_origin(window: &tauri::WebviewWindow) -> String {
  let dev_url = window.config().build.dev_url.as_ref();
  match dev_url.filter(|_| tauri::is_dev()) {
    Some(url) => url.origin().ascii_serialization(),
    None => BUILT_ORIGIN.to_string(),
  }
}

#[cfg(windows)]
pub fn grant_midi(window: &tauri::WebviewWindow) -> tauri::Result<()> {
  let origin = app_origin(window);
  window.with_webview(move |webview| {
    let granted = unsafe { add_midi_grant(&webview.controller(), origin) };
    if let Err(error) = granted {
      eprintln!("zvid: the MIDI permission could not be granted: {error}");
    }
  })
}

#[cfg(windows)]
unsafe fn add_midi_grant(
  controller: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller,
  origin: String,
) -> windows_core::Result<()> {
  use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Profile4, ICoreWebView2_13, COREWEBVIEW2_PERMISSION_KIND,
    COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES,
    COREWEBVIEW2_PERMISSION_STATE_ALLOW,
  };
  use webview2_com::{
    CoTaskMemPWSTR, PermissionRequestedEventHandler, SetPermissionStateCompletedHandler,
  };
  use windows_core::{Interface, HSTRING, PWSTR};

  let webview = controller.CoreWebView2()?;

  // Answers a request before the saved state below is in place, and on
  // WebView2 runtimes too old to save one.
  let request_origin = origin.clone();
  let mut token = 0;
  webview.add_PermissionRequested(
    &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
      let Some(args) = args else { return Ok(()) };
      let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
      args.PermissionKind(&mut kind)?;
      if kind != COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES {
        return Ok(());
      }
      let mut uri = PWSTR::null();
      args.Uri(&mut uri)?;
      if has_origin(&CoTaskMemPWSTR::from(uri).to_string(), &request_origin) {
        args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
      }
      Ok(())
    })),
    &mut token,
  )?;

  // WebView2 raises no request for a permission saved in the profile, so
  // anyone who chose Block in the old prompt would otherwise be denied for
  // good, with no way to change it. Saving the grant replaces that choice.
  let profile = webview.cast::<ICoreWebView2_13>().and_then(|webview| webview.Profile());
  if let Ok(profile) = profile.and_then(|profile| profile.cast::<ICoreWebView2Profile4>()) {
    profile.SetPermissionState(
      COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES,
      &HSTRING::from(origin),
      COREWEBVIEW2_PERMISSION_STATE_ALLOW,
      &SetPermissionStateCompletedHandler::create(Box::new(|_| Ok(()))),
    )?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::has_origin;

  #[test]
  fn matches_the_page_at_the_app_origin() {
    let origin = "http://tauri.localhost";
    assert!(has_origin("http://tauri.localhost/", origin));
    assert!(has_origin("http://tauri.localhost/index.html?sample=1", origin));
    assert!(has_origin("http://localhost:1420/", "http://localhost:1420"));
  }

  #[test]
  fn rejects_other_origins() {
    let origin = "http://tauri.localhost";
    assert!(!has_origin("https://tauri.localhost/", origin));
    assert!(!has_origin("http://tauri.localhost:8080/", origin));
    assert!(!has_origin("http://tauri.localhost.example.com/", origin));
    assert!(!has_origin("https://example.com/", origin));
    assert!(!has_origin("not a uri", origin));
  }
}
