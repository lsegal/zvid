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

Wrangler's build command, `pnpm run cf:prepare`, builds the app and then runs `scripts/fetch-capture-installers.ts`, which copies the ZVID Capture installers from the latest successful `DAW bundles` run on `main` into `dist/downloads` for **Help → Install Capture Plugin**. It needs a GitHub token (`GH_TOKEN`, `GITHUB_TOKEN` or a `gh auth login` session); without one the app deploys with no installers, unless `ZVID_REQUIRE_CAPTURE_INSTALLERS=1` makes that an error, as in the deploy workflow. The deploy workflow also redeploys whenever `DAW bundles` succeeds on `main`, so the downloads follow the newest bundles.

MP4 export uses the zvidlib bridge built during the app build. The runtime needs a HEVC or AV1 video encoder. Audible exports use a browser AAC encoder when available; the native macOS app can also use AudioToolbox.

To check playable browser and Tauri exports, follow [the MP4 export smoke test](EXPORT_SMOKE_TEST.md).

## Media harness

`window.harness` owns session open, media analysis, and export. The web harness routes session access through the local Vite middleware, while Tauri upgrades the same contract with native dialogs and filesystem-backed URLs.

The editor only supplies canvas frames and timeline state. Media analysis uses the shared reader, while export encodes platform-supported tracks and writes the final MP4 through zvidlib.

## Collaboration signaling

Collaboration signals through zvid's own [signaling worker](../signaling/README.md) (`wss://zvid-signaling.lsegal.workers.dev`) by default, with the public `wss://y-webrtc-eu.fly.dev` y-webrtc relay as a fallback. Peers find each other through any server they share. To use different servers, copy `.env.example` to `.env.local` and set `VITE_SIGNALING_URL` before building. An invite's `signal=` parameter always decides which servers a joiner uses.

After signaling, peers connect directly over WebRTC. By default only STUN servers are used, so peers behind symmetric NAT, CGNAT, mobile hotspots or corporate firewalls may not connect; set `VITE_ICE_SERVERS` (see `.env.example`) to add a TURN relay.

While sharing or joined, click the connection status in the header for diagnostics: each signaling server, peers found and connected over WebRTC, whether the project state has synced, and the last error. The browser console logs the same events as `[zvid] collaboration:*`.

Tabs of the same browser profile also sync through `BroadcastChannel`, which works even when signaling and WebRTC are broken, so test sharing with two different browsers or machines (the diagnostics list same-browser tabs separately). `pnpm test:web` runs a two-browser-context test against a local signaling server (`e2e/collaboration.spec.ts`).

## Versioning

`app/package.json` is the source of truth for the zvid version. Tauri reads it directly (`"version": "../package.json"` in `src-tauri/tauri.conf.json`), and a unit test fails if the version in `src-tauri/Cargo.toml` drifts, so bump both together.

Vite injects the version and the build's commit at build time. The frontend reads them as `ZVID_VERSION` from `src/version.ts`, e.g. `0.0.0+c94f40e`, or the bare `0.0.0` when the commit is unknown (e.g. building from a tarball without git). The deployed `/version.json` also includes the version.
