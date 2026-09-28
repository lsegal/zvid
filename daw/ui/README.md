# ZVID Capture UI

The plugin editor's web frontend: Vite + React + TypeScript, linted with the
repo's Biome config like `/app`. The build (`dist/`) is embedded into the
plugin by `zvid-daw-ui` and served from `zvid://app/`; nothing is loaded
from the network at runtime, fonts included.

The screen, states, components and copy follow [`daw/DESIGN.md`](../DESIGN.md).
The palette and the bundled Space Grotesk / IBM Plex Mono fonts come from
[`@zvid/tokens`](../../packages/tokens), shared with `/app`.

## Dev loop

No DAW or Rust build needed. Run the Vite dev server and open
http://localhost:5174 in a browser:

```console
pnpm --dir daw/ui install
pnpm --dir daw/ui dev
```

Without a plugin host the page starts the **web driver** (`src/web`), a
TypeScript port of the Rust mock backend that answers the `zvid://`
protocol in the page. Query options:

- `?platform=windows` renders as on Windows (default macOS).
- `?takes=none` starts without the demo takes.
- `?manual-transport` stops the simulated transport (by default it plays
  4 s, stops 2 s while armed, so takes appear).
- `?live` simulates the Live companion script, like the harness's `--live`.
- `?frames=off` stops the simulation, preview frames included.

`window.__ZVID_DRIVER__` is the running driver; from the devtools console,
`__ZVID_DRIVER__.backend.setPlaying(true)` plays the transport and
`__ZVID_DRIVER__.desktop` lists the takes revealed and settings opened.
Take playback isn't served in the browser.

To check the editor in the real system webview, run the Rust harness, which
hosts it in a plain window against the Rust mock backend:

```console
pnpm --dir daw/ui dev                                          # http://localhost:5174 with HMR
cargo run -p zvid-daw-ui --example harness -- --dev            # in daw/
```

Without `--dev` the harness serves the embedded build, so run
`pnpm --dir daw/ui build` first. Other harness flags:

- `--instances N` opens N editors with separate backends, like N plugin
  instances.
- `--reopen-every SECS` tears the editors down and re-attaches them.
- `--manual-transport` stops the simulated transport (by default it plays
  4 s, stops 2 s while armed, so takes appear).
- `--live` simulates the Live companion script, cycling every 4 s through
  disconnected, connected with Live's Record off, and connected with it on,
  so both capture card states show.

The mock offers cameras that fail on purpose: *Studio Display Camera*
(permission denied) and *OBS Virtual Camera* (in use). *Refresh devices*
adds a phone webcam.

## Bridge

`src/ipc/client.ts` talks to the Rust host over the `zvid://` protocol
(see `daw/crates/zvid-daw-ui/src/protocol.rs`):

- `invoke(command, args)` POSTs to `zvid://ipc/<command>`.
- Events (`status`, `camerasChanged`, `takeOpened`, `takeClosed`, `error`)
  are long-polled from `zvid://ipc/events`.
- Preview frames are long-polled JPEGs from `zvid://preview/frame`.
- `zvid://take/<id>` streams takes with `Range` support; `zvid://thumb/<id>`
  returns poster frames; `zvid://frames/<id>?t=<seconds>` returns frames the
  host decodes, which the take preview plays when the webview can't decode
  the take itself.

The host injects `window.__ZVID__` with the platform's URL origins (WebView2
reaches `zvid://<host>` as `https://zvid.<host>`).

## Checks

```console
pnpm --dir daw/ui test       # node:test unit tests, the IPC client against the web driver
pnpm --dir daw/ui test:web   # Playwright browser tests against the web driver
pnpm --dir daw/ui build      # type-check and bundle
pnpm lint                    # from the repo root: tsc + Biome
```

The browser tests (`e2e/`) start their own dev server on port 5175 and need
Chromium once: `pnpm --dir daw/ui exec playwright install chromium`. When
the Rust mock (`daw/crates/zvid-daw-ui/src/mock.rs`) or protocol changes,
change `src/web` to match.
