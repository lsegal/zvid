---
name: zvid-control
description: Drive the zvid video editor through its control surface, window.zvid, to build, edit and export a session without the UI. Use when an agent needs to create a session, import media, add clips and layers, add and configure effects, move the playhead, play, loop, or export a video in a running zvid tab or desktop app.
---

# Driving zvid

zvid exposes every editing operation as a command on `window.zvid` in the
running app, in the web app and the desktop (Tauri) app alike. A command
takes a JSON object and resolves to a JSON result; it never throws.

```js
await window.zvid.call("get_session");
// → { ok: true, result: { name, bpm, layers: [...], clips: [...], ... } }

await window.zvid.call("add_layer", { name: 3 });
// → { ok: false, error: { code: "invalid_input", message: "...", problems: [...] } }
```

`window.zvid.tools()` lists the commands as tools, `{ name, description,
inputSchema }` with a JSON Schema for the input, the shape MCP's
`tools/list` and model tool-calling APIs take. It is the authoritative
reference for every command's inputs; this document explains how they fit
together.

Run JavaScript in the zvid page to reach it, for example through the
Chrome DevTools Protocol (`Runtime.evaluate` with `awaitPromise: true`),
Playwright's `page.evaluate`, or a browser automation tool's script runner.

## Concepts

- **Beats.** Every timeline position and length is in beats: quarter notes
  at the session tempo (`bpm`). At 120 bpm a beat is half a second, and a
  bar of 4/4 is 4 beats.
- **Layers** hold the clips that make the picture and the sound. They are
  listed top to bottom, and a higher layer draws over a lower one. A clip
  placed over others on its layer replaces what it covers.
- **Source tracks** hold the session's media. `import_media` puts a file on
  a source track as a **source clip**; a **media clip** on a layer then
  shows part of a source track.
- **Clips** come in four kinds: `media` (imported video or audio), `fill`
  (a solid color), `text`, and `fx` (an FX clip, whose own effects change
  everything beneath it while it plays).
- **Effects** sit in ordered stacks: the Global stack (the whole picture
  and mix), each layer's stack, each clip's own stack, and each source
  track's and source clip's. A stack runs top to bottom. Video and audio
  effects share stacks. `list_effects` gives every effect's name, the stacks
  it works on, and its parameters with their ranges and options.
- Every edit is one undoable step; `undo` and `redo` work as Edit → Undo
  and Redo do, on the agent's edits and the user's alike.

## Commands

| Command | Does |
| --- | --- |
| `get_session` | The whole session: settings, playhead, loop, selection, layers, clips, source tracks and clips, media, effects with their parameter values |
| `new_session` | A blank session (`discardUnsavedChanges: true` to drop unsaved work) |
| `update_session` | Name, tempo, frame rate, canvas size, export video codec |
| `undo`, `redo` | Step through the edit history |
| `add_layer`, `update_layer`, `delete_layer` | Create, rename, hide, bypass, reorder and delete layers |
| `import_media` | Fetch a file from a URL (http(s), `data:` or `blob:`) into a source track |
| `add_clip`, `update_clip`, `delete_clip` | Put clips on layers, move and resize them, delete them |
| `list_effects` | The effects there are, with their parameters |
| `add_effect`, `set_effect_parameter`, `update_effect`, `remove_effect` | Build and configure effect stacks |
| `set_playhead`, `play`, `pause` | The playhead and playback |
| `set_loop` | The loop region playback repeats |
| `select_clip` | Select a clip, as clicking it does |
| `export_video` | Render the session to a video file and wait for it |

## Building a session

1. Start clean, and set the canvas and tempo:
   `new_session` with `{ discardUnsavedChanges: true }`, then
   `update_session` with `{ name: "Promo", bpm: 120, canvasWidth: 1080,
   canvasHeight: 1920 }`.
2. Import media: `import_media` with `{ url: "https://example.com/a.mp4" }`
   (pass `name` when the URL has no file name, as with `data:` URLs). The
   result lists the media and its `sourceClips`.
3. Read the layer ids with `get_session`, or add layers with `add_layer`.
4. Place the media: `add_clip` with `{ kind: "media", layerId,
   startBeats: 0, durationBeats: 8, sourceClipId }` shows the source clip
   from its start. To show a later part, pass `sourceTrackId` and
   `sourceStartBeats` instead.
5. Add titles: `add_clip` with `{ kind: "text", layerId, startBeats: 0,
   durationBeats: 4, text: "Hello" }` on a layer above the media. Its result
   names the clip's Text effect; style it with `set_effect_parameter`
   (`FontSize`, `Color`, `Align`, ...).
6. Add effects: `add_effect` with `{ effectName: "Reverb", target: "clip",
   targetId: clipId }`, then `set_effect_parameter` with `{ effectId, key:
   "Size", value: 0.8 }`. `target` is `global`, `layer`, `clip`,
   `source-track` or `source-clip`; every target but `global` needs
   `targetId`.
7. Export: `export_video` resolves when the file is written. By default
   (`destination: "memory"`) it returns a `blob:` URL to `fetch` from the
   page; `"download"` saves it through the browser's downloads; in the
   desktop app, `"path"` with an absolute `path` writes it there. Pass
   `startBeats` and `endBeats` to export part of the session.

## Errors

A failed command resolves to `{ ok: false, error: { code, message } }`. The
message says what was wrong and, where it helps, what to call instead.

| Code | Means |
| --- | --- |
| `invalid_input` | The input broke the command's schema or a value is out of range; `problems` lists each problem |
| `unknown_command` | No command has that name |
| `not_found` | An id names nothing in the session; call `get_session` |
| `unavailable` | The session can't do that now: a read-only tab, nothing to play or undo, an effect a stack doesn't take |
| `failed` | Fetching, importing or exporting failed |

Commands run one at a time in the order they are called, so a script can
fire several without awaiting each.
