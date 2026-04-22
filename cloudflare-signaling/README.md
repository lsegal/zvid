# zvid Cloudflare signaling

This is a standalone Cloudflare Worker for the `y-webrtc` signaling step used by zvid collaboration. It is intentionally isolated from the main app package and can be deployed independently with Wrangler.

## What it does

- Accepts WebSocket upgrades
- Implements the small `y-webrtc` pub/sub signaling protocol (`subscribe`, `unsubscribe`, `publish`, `ping`)
- Uses a Durable Object as the broker so all signaling clients share a single room registry

This worker only handles peer discovery and signal fanout. It does not carry document state; the actual sync remains peer-to-peer over WebRTC.

## Local development

```sh
cd cloudflare-signaling
npm install
npm run dev
```

Wrangler will print a local WebSocket URL you can use as the signaling endpoint.

## Deploy

```sh
cd cloudflare-signaling
pnpm install
pnpm run deploy
```

After deploy, Cloudflare will give you a Worker URL such as:

```txt
wss://zvid-signaling.lsegal.workers.dev
```

Use that URL as the collaboration signaling server.

## Wire zvid to it

You have two options:

1. Paste the deployed WebSocket URL into the collaboration signaling field in the app before sharing.
2. Change the default in the app from the Fly host to your Worker URL.

The share invite format already supports a `signal` query parameter, so existing collaboration links can carry the custom signaling endpoint without changing the collaboration protocol.
