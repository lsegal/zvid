# zvid Cloudflare signaling

This is a standalone Cloudflare Worker for the `y-webrtc` signaling step used by zvid collaboration. It is intentionally isolated from the main app package and can be deployed independently with Wrangler.

## What it does

- Accepts WebSocket upgrades
- Implements the small `y-webrtc` pub/sub signaling protocol (`subscribe`, `unsubscribe`, `publish`, `ping`)
- Uses a Durable Object as the broker so all signaling clients share a single room registry

This worker only handles peer discovery and signal fanout. It does not carry document state; the actual sync remains peer-to-peer over WebRTC.

## Local development

```sh
cd signaling
pnpm install
pnpm run dev
```

Wrangler will print a local WebSocket URL you can use as the signaling endpoint (set it as `VITE_SIGNALING_URL` in `../app/.env.local`).

## Deploy

```sh
cd signaling
pnpm install
pnpm run deploy
```

After deploy, Cloudflare will give you a Worker URL such as:

```txt
wss://zvid-signaling.<your-account>.workers.dev
```

Use that URL as `VITE_SIGNALING_URL` when building the app.

## Do you need to self-host this?

No. By default zvid connects to the deployed `wss://zvid-signaling.lsegal.workers.dev` worker and to the public `wss://y-webrtc-eu.fly.dev` relay as a fallback, so collaboration works out of the box without deploying anything.

This worker (or the public relay) only helps browsers find each other; it never sees project content. If you'd rather not depend on a third-party relay, deploy your own copy with the steps above and either:

1. Build the app with `VITE_SIGNALING_URL` pointing at it, or
2. Paste the deployed WebSocket URL into the collaboration signaling field in the app before sharing.

The share invite format supports a `signal` query parameter, so collaboration links carry the signaling endpoint they were created with.
