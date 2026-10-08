# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Cloudflare Worker deploy

This app can also deploy to Cloudflare Workers as a static asset app served by a small Worker.

```sh
pnpm install
pnpm run deploy:dry-run
pnpm run deploy
```

Wrangler uses [wrangler.jsonc](d:\github\lsegal\zvid\app\wrangler.jsonc) and serves the built Vite output from `dist/` with SPA fallback enabled.

Wrangler's build command, `pnpm run cf:prepare`, only builds the app. The ZVID Capture installers offered by **Help → Install Capture Plugin** are not deployed with it: every merge to `main`, the `DAW bundles` workflow overwrites `capture/zvid-capture-macos.pkg`, `capture/zvid-capture-windows-setup.exe` and `capture/manifest.json` in the `zvid-downloads` R2 bucket, and the zvid desktop app installers offered by **Help → Download Desktop App** as `desktop/zvid-macos.dmg`, `desktop/zvid-windows-setup.exe` and `desktop/manifest.json`, and the Worker serves that bucket at `/downloads/*` through its `DOWNLOADS` binding (`worker/downloads.ts`, with `HEAD`, `Range` and `ETag` support). New installers are live as soon as they are published, with no redeploy. Publishing uses the repository's existing `CLOUDFLARE_API_TOKEN` secret and `CLOUDFLARE_ACCOUNT_ID` variable, the same ones the Deploy workflow uses; the token needs **Account → Workers R2 Storage → Edit** on the account that owns `zvid-downloads`. `wrangler dev` uses an empty local bucket, so the dialog reports no installers there.

MP4 export uses the zvidlib bridge built during the app build. The runtime needs a HEVC or AV1 video encoder. Audible exports use a browser AAC encoder when available; the native macOS app can also use AudioToolbox.

Choosing VP8 or VP9 as the video codec exports WebM instead: the browser encodes the video, and the bridge encodes the audio to 48 kHz Opus with zvidlib's own encoder and writes the WebM, so every harness exports the same file.

To check playable browser and Tauri exports, follow [the MP4 export smoke test](EXPORT_SMOKE_TEST.md).

## Media harness

`window.harness` owns session open, media analysis, and export. The web harness routes session access through the local Vite middleware, while Tauri upgrades the same contract with native dialogs and filesystem-backed URLs.

The editor only supplies canvas frames and timeline state. Media analysis uses the shared reader, while export encodes platform-supported tracks and writes the final MP4 or WebM through zvidlib.

## Collaboration signaling

Collaboration signals through zvid's own [signaling worker](../signaling/README.md) (`wss://zvid-signaling.lsegal.workers.dev`) by default, with the public `wss://y-webrtc-eu.fly.dev` y-webrtc relay as a fallback. Peers find each other through any server they share. To use different servers, copy `.env.example` to `.env.local` and set `VITE_SIGNALING_URL` before building. An invite's `signal=` parameter always decides which servers a joiner uses.

Since an invite can name any signaling server, the native app's CSP allows every `ws:` and `wss:` URL in `connect-src` (`src-tauri/tauri.conf.json`) rather than listing the defaults; other `connect-src` origins stay restricted. `src/native-csp.test.ts` checks that the CSP covers the default signaling servers and native relay.

After signaling, peers connect over WebRTC. Public STUN servers let most peers connect directly, but peers behind symmetric NAT, CGNAT, mobile hotspots or corporate firewalls need a TURN relay. The deployed app provides one (see [Collaboration TURN relay](#collaboration-turn-relay)); `VITE_ICE_SERVERS` (see `.env.example`) adds your own STUN or TURN servers at build time.

### Collaboration TURN relay

Before each collaboration session the app fetches short-lived TURN credentials from its own Worker at `GET /api/ice-servers` (`worker/turn.ts`) and adds them to the configured ICE servers. The Worker mints them with [Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/)'s `generate-ice-servers` API; the credentials expire after 24 hours, and the app reuses them for an hour before fetching new ones. No TURN secret is built into the app. If the fetch fails or times out, the session starts with STUN (and `VITE_ICE_SERVERS`) only, and the console logs `[zvid] collaboration:ice:relay:error`. The diagnostics dialog's **Relay (TURN)** row reads **Configured** when a relay was obtained.

The Worker needs two secrets, the TURN key's ID and its API token:

```sh
cd app
pnpm exec wrangler secret put TURN_KEY_ID
pnpm exec wrangler secret put TURN_KEY_API_TOKEN
```

Create the key in the Cloudflare dashboard (**Realtime → TURN Server → Create**), which shows the API token once. Without both secrets `/api/ice-servers` answers `503` and the app uses STUN only. For `wrangler dev`, put them in `app/.dev.vars`.

To limit abuse of the TURN key, the endpoint only mints credentials for the app itself and caps how often one client can mint them:

- Requests a browser marks as coming from another site (`Sec-Fetch-Site` other than `same-origin`, or an `Origin` other than the Worker's own) get `403`, except from the native app's origins (see below).
- Each client IP (`CF-Connecting-IP`) can mint 10 credentials per minute, counted by the Workers [Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) binding `TURN_RATE_LIMITER` (`ratelimits` in `wrangler.jsonc`, which `wrangler deploy` creates; no setup needed). Requests over the limit get `429` with `Retry-After`, and the app starts that session with STUN only. The limit is per Cloudflare location and approximate, so it curbs scripted minting rather than capping it exactly.

To rotate the token, create a new TURN key, `wrangler secret put` both secrets with the new key's values (secrets take effect immediately, without a redeploy), then delete the old key. Credentials already handed out stop working when the old key is deleted, so connected peers may need to reconnect; delete it after a day to let them expire instead.

The web app uses its own origin's `/api/ice-servers`, so `wrangler dev` (`pnpm cf:dev`) exercises the relay too. The native app has no Worker of its own, so it uses the deployed app's `https://zvid.lsegal.workers.dev/api/ice-servers` by default; the Worker allows the native app's origins (`tauri://localhost` on macOS and Linux, `http://tauri.localhost` on Windows) through CORS, still subject to the rate limit, and the native app's CSP allows that origin in `connect-src` (`src-tauri/tauri.conf.json`). `pnpm tauri:dev` loads the app from the Vite dev server's origin, which the Worker doesn't allow, so it falls back to STUN only. The Vite dev server (`pnpm dev`) has no Worker, so it uses STUN only unless `VITE_ICE_SERVERS_URL` names an endpoint returning `{ "iceServers": [...] }` that allows the page's origin through CORS. `VITE_ICE_SERVERS_URL` also overrides the native default, and `VITE_ICE_SERVERS_URL=none` turns the relay off.

While sharing or joined, click the connection status in the header for diagnostics: each signaling server, peers found and connected over WebRTC, whether the project state has synced, and the last error. The browser console logs the same events as `[zvid] collaboration:*`.

Tabs of the same browser profile also sync through `BroadcastChannel`, which works even when signaling and WebRTC are broken, so test sharing with two different browsers or machines (the diagnostics list same-browser tabs separately). `pnpm test:web` runs a two-browser-context test against a local signaling server (`e2e/collaboration.spec.ts`).

## Where code goes

Keep modules small and put new code where it belongs rather than growing `App.tsx`:

- React hooks go in `src/hooks`.
- Components go in `src/components`.
- App-shell modules (types, constants and helpers the shell shares) go in `src/app`.
- Each effect lives in its own folder, `src/fx/effects/<name>`.
- Menus, keyboard shortcuts and status bar items are added through their registries, not inline in the shell.

`pnpm --dir app run lint` (and the root `pnpm lint`) runs `scripts/check-file-size.mjs`, which fails when a `src` file (`.ts`, `.tsx` or `.css`; tests, declarations, fixtures and generated files excluded) exceeds 800 lines. Files already over the limit are recorded in `scripts/file-size-allowlist.json` at their current size: they may shrink but never grow. When one shrinks the check prints a hint; run `node app/scripts/check-file-size.mjs --write` to ratchet the allowlist down, which also drops files that are back within the limit. Split an oversized file instead of raising its entry.

## Versioning

`app/package.json` is the source of truth for the zvid version. Tauri reads it directly (`"version": "../package.json"` in `src-tauri/tauri.conf.json`), and a unit test fails if the version in `src-tauri/Cargo.toml` drifts, so bump both together.

Vite injects the version and the build's commit at build time. The frontend reads them as `ZVID_VERSION` from `src/version.ts`, e.g. `0.0.0+c94f40e`, or the bare `0.0.0` when the commit is unknown (e.g. building from a tarball without git). The deployed `/version.json` also includes the version.
