// Applies a saved light theme before the first paint, so loading never
// flashes the dark one (#1488). Keep the key and color in sync with
// src/theme.ts; the app takes over once it loads.
try {
  if (localStorage.getItem('zvid-theme') === 'light') {
    document.documentElement.dataset.theme = 'light';
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', '#e3e5ea');
  }
} catch {
  // Storage can be unavailable; the app starts dark.
}
