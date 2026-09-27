# ZVID Capture UI

The plugin editor's web frontend: Vite + React + TypeScript, linted with the
repo's Biome config like `/app`. The build (`dist/`) is embedded into the
plugin by `zvid-daw-ui` and served from `zvid://app/`; nothing is loaded
from the network at runtime, fonts included.

The screen, states, components and copy follow [`daw/DESIGN.md`](../DESIGN.md).
The palette and the bundled Space Grotesk / IBM Plex Mono fonts come from
[`@zvid/tokens`](../../packages/tokens), shared with `/app`.

## Dev loop

No DAW needed. Run the Vite dev server and the Rust harness, which hosts the
editor in a plain window against a mock backend:

```console
pnpm --dir daw/ui install
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
pnpm --dir daw/ui test     # node:test unit tests
pnpm --dir daw/ui build    # type-check and bundle
pnpm lint                  # from the repo root: tsc + Biome
```
