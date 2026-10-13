# zvid MCP server

`zvid-mcp.mjs` is a [Model Context Protocol](https://modelcontextprotocol.io)
server that lets an external agent, such as Claude Code, Codex or any other
MCP client, drive a running zvid: a web app tab or the desktop app. It
publishes zvid's control surface (`window.zvid`, see
[`src/control/SKILL.md`](../../src/control/SKILL.md)) as MCP tools and relays
each tool call to the app, which runs the command and returns its result.

It runs from a checkout of this repository with Node 22 or later, after
`pnpm install` in `app/`.

## Register it with an agent

The server speaks MCP over stdio. Use the absolute path to your checkout.

Claude Code:

```sh
claude mcp add zvid -- node /path/to/zvid/app/scripts/agent-relay/zvid-mcp.mjs
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.zvid]
command = "node"
args = ["/path/to/zvid/app/scripts/agent-relay/zvid-mcp.mjs"]
```

Other clients take the same command in their MCP server configuration, for
example `{"command": "node", "args": ["/path/to/zvid/app/scripts/agent-relay/zvid-mcp.mjs"]}`.

## Connect zvid

- **Web app tab.** Open zvid with `?agent-relay` in its address, such as
  `http://localhost:1420/?agent-relay` for `pnpm dev`. The tab connects to
  the server on `ws://127.0.0.1:47311` and keeps reconnecting while the
  server isn't running, so the tab and the agent can start in either order.
  The setting lasts until the tab closes. `?agent-relay=<port>` or
  `?agent-relay=ws://host:port` points the tab at a server started with
  `--port`. When several tabs connect, the most recent one is driven.
- **Desktop app.** Nothing to set up: whenever the desktop app runs, it
  listens on a loopback port and records the port and a per-launch token in
  `agent-relay.json` in its app data folder (`~/Library/Application
  Support/cc.zvid.edit` on macOS, `%APPDATA%\cc.zvid.edit` on Windows,
  `~/.local/share/cc.zvid.edit` on Linux). The server reads that file, so
  only a process that can read your files can drive the app.

## Tools

- `zvid_status` reports which zvid instances the server can reach.
- Every control-surface command (`get_session`, `add_clip`, `add_effect`,
  `export_video` and the rest) as its own tool, once a zvid is connected.
  The server tells the client its tool list changed whenever a tab connects
  or disconnects.
- `zvid_list_commands` and `zvid_call` (`{ "name": ..., "arguments": {...} }`)
  reach the same commands for clients that don't refresh their tool list.

A command's failure comes back as a tool error carrying the control
surface's error, with its `code` and `message`.

## Options

| Option | Meaning |
| --- | --- |
| `--target auto\|web\|desktop` | Which zvid to drive. `auto` (the default) drives a connected web tab, else the desktop app. |
| `--port <n>` | The loopback port web tabs connect to (default 47311). |
| `--allow-origin <origin>` | Also accept web tabs served from this origin. Local dev servers, the deployed app and the desktop webview are always accepted. Repeatable. |

`ZVID_DESKTOP_RELAY_FILE` overrides where the server looks for the desktop
app's `agent-relay.json`.

## Protocol

Both channels carry the same requests: `{ method: "list" }` for the
commands, and `{ method: "call", name, arguments }` to run one, answered
with `{ ok: true, result }` or `{ ok: false, error: { code, message } }`.

- A web tab sends `{ type: "hello", app: "zvid", target: "web", version }`
  on connecting, then answers `{ type: "request", id, ... }` messages with
  `{ type: "response", id, ... }` (`src/agent-relay/web-tab.ts`).
- The desktop app takes one JSON line per request, `{ token, request }`,
  and answers with one JSON line (`src-tauri/src/agent_relay.rs`). Its
  native process hands each request to the window as an
  `agent-relay:request` event (`src/agent-relay/desktop.ts`).

`agent-relay.test.mjs` round-trips commands through both channels.
