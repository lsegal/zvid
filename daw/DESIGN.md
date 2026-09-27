# ZVID Capture: design system and UX

This document defines the screen, states, visual tokens, components, motion,
accessibility rules and copy for the **ZVID Capture** plugin UI (`daw/ui`,
hosted by `daw/crates/zvid-daw-ui`). It is the reference for anyone building or
reviewing plugin UI. Architecture lives in `daw/ARCHITECTURE.md`
([#190](https://github.com/lsegal/zvid/issues/190)); the overall effort is
tracked in [#189](https://github.com/lsegal/zvid/issues/189).

> **No imagery in this repo.** This doc describes the design in words and
> tokens only: no screenshots, no third-party product imagery, and no copied
> layouts or artwork. The lo-fi wireframes (idle, capturing, ready with takes)
> live in [#191](https://github.com/lsegal/zvid/issues/191) and stay there.

## Principles

- **One product.** The plugin and the `/app` editor share tokens and type so
  they feel like the same tool.
- **Capture first.** The single most important control is Record. It is
  always visible, always in the same place, and its state is unambiguous.
  When Live's own record buttons arm capture (the Live companion is
  connected), the same place shows which state Live is in instead.
- **Stay out of Live's way.** Dark only, compact, no modal dialogs, and no
  animation beyond what communicates state.
- **Never lose footage.** Every take is listed, including unanchored captures
  and takes whose file has gone missing.

## Screen

The plugin is a single window.

| Property | Value |
|---|---|
| Default size | **680 × 760 pt** |
| Minimum size | **560 × 620 pt** |
| Resizable | Yes, down to the minimum; the layout reflows, it does not scale |

The window has five regions, laid out top to bottom with the preview and the
right column side by side in the middle:

```text
┌───────────────────────────────────────────────┐
│ 1 Header: status dot · status label   camera ▾│
├───────────────────────┬───────────────────────┤
│                       │ 3 Capture card        │
│ 2 Preview             ├── Takes (N) ──────────┤
│   (left column)       │ 4 Takes list          │
│                       │   (scrolls)           │
├───────────────────────┴───────────────────────┤
│ 5 Footer: device · resolution · fps   version │
└───────────────────────────────────────────────┘
```

The header and footer are fixed height. The middle row fills the remaining
height; the takes list is the only region that scrolls.

### 1. Header

- **Status dot** and **status label** on the left. The label is one of:

  | State | Dot | Label |
  |---|---|---|
  | No camera | grey (`--muted`) | *No camera* |
  | Ready | green (`--mint`) | *Ready to capture* |
  | Capturing | pink (`--pink`), pulsing | Timer pill `00:00:05` |
  | Camera error | amber (`--amber`) | *Camera unavailable* |

  While capturing, the label is replaced by a **TimerPill**: elapsed capture
  time as `HH:MM:SS` in IBM Plex Mono on a pink pill.
- **Camera dropdown** on the right: a pill-shaped **Select** listing every
  device from the capture layer (built-in, USB, Continuity Camera, phone
  webcams). Each option shows the device name on the first line and its
  transport type (*USB*, *Continuity*, *Virtual*, *Built-in*) as a secondary,
  `--muted` line. The last choice is remembered in plugin state and restored by
  unique device ID first, then by device name. The dropdown is disabled while
  capturing, because a capture file is bound to one device.

### 2. Preview (left column)

- **Live** state: the camera preview, letterboxed on `--bg` so portrait phone
  cameras and 16:9 webcams both fit without cropping. Radius matches Card.
- **Empty** state (no camera selected, or none present): a dashed
  `--line-strong` frame with the **EmptyState** component:
  - title *No camera selected*;
  - hint *Connect a camera or choose one from the menu above.*;
  - secondary button **Refresh devices**.
- **Error** state (permission denied, or device busy in another app): the
  frame shows an amber StatusDot and a message:
  - permission denied: *Camera access is off for Ableton Live.* On macOS, add
    the link **Open Privacy Settings**, which opens the Camera pane of System
    Settings. On Windows, name the equivalent setting in text.
  - device busy: *This camera is in use by another app.* with **Refresh
    devices**.
- **Connecting** state (device chosen, no frame yet): the frame with a busy
  spinner and *Starting camera…*.

### 3. Capture card (right column, top)

The card has two states, depending on whether the optional
[Live companion script](live-remote-script/README.md) is connected. Without
it, the plugin can't tell when Live is recording, so the user arms capture
here. With it, Live's own **Arrangement Record** and **Session Record**
buttons arm capture, and a Record button in the plugin would be a second,
competing switch.

**Companion not connected** (the default):

- The **primary button** toggles between **● Record** and **■ Stop
  capturing**. It is disabled when there is no usable camera.
- Helper text, `--muted`: *Arm capture before you start playback or recording
  in Live.*

```text
┌────────────────────────────────┐
│ (           ● Record         ) │  primary button
│  Arm capture before you start  │  helper
│  playback or recording in Live.│
└────────────────────────────────┘
```

**Companion connected:**

- The Record button is replaced by a read-only **LiveFollowing** indicator
  in the same place: *Following Live's record button*, and below it the
  armed state, *Record on in Live* or *Record off in Live*. It is not a
  button and does not react to the pointer or keyboard.
- Helper text, `--muted`: *Turn on Record in Live to arm capture.*
- A capture that is already running keeps its **■ Stop capturing** button,
  shown above the indicator, so a capture can always be stopped from the
  plugin (for example one armed here before the companion connected).

```text
Live's record buttons off              Live's record buttons on
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ ╭──────────────────────────╮ │      │ ╭──────────────────────────╮ │
│ │ Following Live's record  │ │      │ │ Following Live's record  │ │
│ │ button                   │ │      │ │ button                   │ │
│ │ ○ Record off in Live     │ │      │ │ ● Record on in Live      │ │  pink ● and outline
│ ╰──────────────────────────╯ │      │ ╰──────────────────────────╯ │
│ Turn on Record in Live to    │      │ Turn on Record in Live to    │
│ arm capture.                 │      │ arm capture.                 │
└──────────────────────────────┘      └──────────────────────────────┘
```

The card switches between the two states on its own, with no reload: within
about a second of the companion starting to answer, and within about 3 s of
it going quiet (the plugin's link timeout), for example when the companion
is removed from Live's control surfaces or Live quits. To enable the
companion, install it and pick **ZVID Capture** as a Control Surface in
Live's *Link, Tempo & MIDI* settings; see
[`live-remote-script/README.md`](live-remote-script/README.md).

In both states, while capturing, a line below reads *Takes follow transport:
N*, the live count of takes opened during this capture. It updates as Live's
transport starts and stops.

### 4. Takes list (right column, below the capture card)

A hairline divider labelled **Takes (N)** separates it from the capture card.
The list shows one **TakeCard** per take in plugin state, newest first. Each
card has:

- a **thumbnail**: the poster frame at the take start;
- a **▶ play** icon button that previews the take inline, playing only that
  take's range of the file; while playing it becomes **■ stop**;
- date and time of the take, its duration (`mm:ss`), and its transport
  position (`Bar 17.1.1`), with duration and bar position in IBM Plex Mono;
- a **folder** icon button that reveals the file in Finder (macOS) or File
  Explorer (Windows).

Take variants:

- **Missing file:** the card is dimmed (content at 50% opacity), shows a
  *File missing* badge in `--amber`, and the play and folder buttons are
  disabled. The entry is kept so nothing silently disappears.
- **Not placed:** a capture made with no playback (an unanchored take) shows a
  *Not placed* badge in `--muted` in place of the bar position. It can still
  be previewed and revealed.
- **Empty list:** EmptyState with *Your takes will show up here*.

### 5. Footer

- Left: active device · resolution · fps, for example
  `FaceTime HD Camera · 1920×1080 · 30 fps`. Shows *No camera* when none is
  active. While recording, frames the encoder couldn't keep up with are
  appended as `· 3 dropped` in `--amber` once the count is above zero
  (`RecordStats::frames_dropped` in `zvid-capture`).
- Right: plugin version, in IBM Plex Mono, `--muted`.

### State summary

| App state | Header | Preview | Capture card | Takes |
|---|---|---|---|---|
| No camera | grey dot, *No camera* | Empty | Record disabled | as stored |
| Ready | green dot, *Ready to capture* | Live | Record enabled | as stored |
| Capturing | pink pulsing dot, TimerPill | Live | Stop capturing, take count | new takes appear at top |
| Camera error | amber dot, *Camera unavailable* | Error | Record disabled | as stored |

With the Live companion connected, *Record disabled* and *Record enabled*
read *LiveFollowing indicator* instead; the other columns don't change.

If the camera fails while capturing, the capture stops, the footage recorded
so far is kept, the header switches to the error state, and a **Toast**
explains what happened.

## Design tokens

The plugin reuses the tokens defined on `:root` in
[`packages/tokens/tokens.css`](../packages/tokens/tokens.css). Values here must
match that file.

### Surfaces

| Token | Value | Use |
|---|---|---|
| `--bg` | `#262839` | Window background, preview letterbox |
| `--bg-elevated` | `#2d3044` | Header, footer |
| `--bg-panel` | `#313447` | Cards (capture card, TakeCard) |
| `--bg-soft` | `#383b50` | Hover fills, secondary buttons, Select |

### Ink

| Token | Value | Use |
|---|---|---|
| `--ink` | `#eef2ff` | Primary text and icons |
| `--muted` | `#a4a9bf` | Secondary text, helper text, footer, grey status dot |
| `--ink-on-accent` *(new)* | `#0f1220` | Text and icons on accent fills (pink button, TimerPill) |

`--ink-on-accent` is the dark text colour `/app` already uses on accent fills
(for example collaboration cursor labels); it is promoted to a token so both
products use one value.

### Lines

| Token | Value | Use |
|---|---|---|
| `--line` | `rgba(255, 255, 255, 0.08)` | Hairline dividers, card borders |
| `--line-strong` | `rgba(255, 255, 255, 0.14)` | Empty-state dashed frame, Select border, hover borders |

### Accents

| Token | Value | Meaning |
|---|---|---|
| `--pink` | `#ff6f9d` | Record / capturing |
| `--mint` | `#7ee0a4` | Ready |
| `--amber` | `#f6b73c` | Warning, error, missing file |
| `--blue` | `#7ca1ff` | Focus ring, links |

Accents carry meaning; do not use them decoratively. Every accent-coded state
also has a text label so colour is never the only signal.

### Where the tokens live

So `/app` and `daw/ui` cannot drift, the shared tokens live in a small CSS
package, [`packages/tokens`](../packages/tokens) (`@zvid/tokens`), whose
`tokens.css` holds the `:root` block and the `@font-face` rules. `/app` and
`daw/ui` both import it, and `app/src/App.css` keeps only app-specific
variables such as the lane-selection colours.

## Typography

| Family | Use |
|---|---|
| **Space Grotesk** (400, 500, 700) | All UI text |
| **IBM Plex Mono** (400, 500, 600) | Timecodes, TimerPill, durations, bar positions, resolution/fps, version |

- Fonts are **bundled** with the frontend and served from `zvid://`; they are
  never loaded from the network. `@zvid/tokens` bundles them for both
  products.
- Mono text uses tabular figures so timers don't jitter.
- Scale (pt): 11 footer and badges, 12 helper and secondary text, 13 body and
  card text, 14 buttons and status label, 16 empty-state titles. Line height
  1.4.

## Spacing and shape

- **4 pt grid.** All padding, gaps and sizes are multiples of 4. Common steps:
  4, 8, 12, 16, 24.
- **Radius:** cards and the preview frame 10–12 pt; primary buttons, the camera
  Select, TimerPill and badges are pills (`999px`); the status dot is a circle.
- **Dividers:** 1 px hairlines in `--line`.
- Minimum hit target for any control: 28 × 28 pt; icon buttons use a 28 pt
  square.

## Components

Every interactive component documents these states: **default**, **hover**,
**pressed**, **focus**, **disabled** and **busy**. Unless a component says
otherwise:

- **hover** lightens the fill one surface step (for example `--bg-panel` →
  `--bg-soft`) or, on accent fills, raises brightness about 8%;
- **pressed** darkens the fill about 8% and removes any lift;
- **focus** (keyboard focus only, `:focus-visible`) draws a 2 px `--blue`
  ring with a 2 px offset;
- **disabled** shows content at 40% opacity and ignores pointer and keyboard
  activation; it stays focusable so its explanation is reachable (see
  Accessibility);
- **busy** keeps the component's size, replaces its icon or leading glyph with
  a small spinner, and ignores repeat activation.

### Button

- **Primary:** pill, `--pink` fill, `--ink-on-accent` text, 36 pt tall. Used
  only for Record / Stop capturing. While capturing, its leading ■ glyph
  replaces the ● and the label changes; the fill stays pink. Busy while the
  capture is starting or finalising the file.
- **Secondary:** pill, `--bg-soft` fill, `--line-strong` border, `--ink` text,
  32 pt tall. Used for **Refresh devices** and similar actions.
- **Icon:** 28 pt square, transparent fill, `--ink` glyph; hover shows a
  `--bg-soft` fill. Used for play/stop preview and reveal-in-folder. Always
  has an accessible label.

### LiveFollowing

- Read-only stand-in for Record while the Live companion is connected (see
  the capture card). Not interactive, so it has no hover, pressed, focus,
  disabled or busy state.
- Full width of the card, at least 36 pt tall like the primary button, with
  an 18 pt radius, a 1 px `--line-strong` outline and no fill, so it doesn't
  read as a button.
- First line, `--ink`, 14 pt medium: *Following Live's record button*.
  Second line, `--muted`, 12 pt: an 8 pt ring glyph and *Record off in Live*;
  while Live records, the glyph fills `--pink`, the outline turns `--pink`
  and the text reads *Record on in Live*. The glyph doesn't pulse: it
  reports Live's switch, not a running capture.

### Select

The camera dropdown. Pill trigger with `--bg-soft` fill, `--line-strong`
border, device name and a chevron. The open menu is a `--bg-elevated` panel
with 10 pt radius; each option has a name line and a `--muted` transport-type
line; the selected option has a check mark. Busy while devices are being
enumerated. Disabled while capturing or when there are no devices.

### StatusDot

An 8 pt circle in the state colour (see the header table). Not interactive,
so it has no hover, pressed, focus or disabled states. While capturing it
pulses (see Motion). Always paired with visible text.

### TimerPill

Pill with `--pink` fill and `--ink-on-accent` IBM Plex Mono text showing
elapsed capture time as `HH:MM:SS`, with a leading pulsing StatusDot drawn in
`--ink-on-accent`. Not interactive. Exposed to assistive technology as a timer
that is not announced every second.

### Card

Container with `--bg-panel` fill, 1 px `--line` border, 12 pt radius and
12–16 pt padding. Not interactive itself.

### TakeCard

A Card laid out as thumbnail (16:9 box, letterboxed like the preview) · text
block · icon buttons. States:

- **default / hover:** hover lightens the card to `--bg-soft` and reveals
  nothing new; the icon buttons are always visible.
- **focus:** the card is a single tab stop with its icon buttons reachable
  inside it; the focused element gets the focus ring.
- **playing:** thumbnail area shows the inline preview and the play button
  becomes stop.
- **busy:** while the poster frame is being generated the thumbnail shows a
  `--bg-soft` placeholder.
- **disabled:** the *File missing* variant described above.

### EmptyState

Centred block: optional dashed `--line-strong` frame, a title in `--ink`, a
hint in `--muted`, and an optional secondary Button. Not interactive except
for its button.

### Toast

Transient message anchored bottom-centre above the footer: `--bg-elevated`
fill, `--line-strong` border, 10 pt radius, optional leading StatusDot for
tone (amber for warnings). Stays 5 s, or until dismissed with its close icon
button; hovering or focusing it pauses the timer. At most one toast is
visible; a newer one replaces it. Announced politely to screen readers. Used
for non-blocking events such as *Capture stopped: the camera was
disconnected. Footage up to that point was saved.*

## Motion

- The capture StatusDot (header and TimerPill) **pulses at 1 Hz** while
  capturing: opacity 1 → 0.35 → 1 over 1 s, ease-in-out, infinite.
- Hover and pressed transitions are 120 ms; the Toast fades and slides 8 pt
  in 180 ms.
- Under `prefers-reduced-motion: reduce`, the pulse is replaced by a steady
  dot and all transitions are instant. Capture state stays readable through
  colour and the TimerPill text.
- Nothing else animates: no looping decoration and no layout animation.

## Accessibility

- **Keyboard:** every control is reachable with Tab in visual order (header →
  preview actions → capture card → takes → toast). Space/Enter activates
  buttons; the Select opens with Space/Enter/↓ and supports arrow keys, type
  ahead and Escape.
- **Focus:** a visible `--blue` focus ring on `:focus-visible` for every
  interactive element. Never remove it without a replacement.
- **Contrast:** text meets **≥ 4.5:1** against its background. Measured WCAG
  ratios for the tokens:

  | Text | on `--bg` | on `--bg-elevated` | on `--bg-panel` | on `--bg-soft` |
  |---|---|---|---|---|
  | `--ink` | 13.0 | 11.6 | 11.0 | 9.8 |
  | `--muted` | 6.2 | 5.6 | 5.3 | 4.7 |
  | `--pink` | 5.6 | 5.0 | 4.7 | **4.2** |
  | `--mint` | 9.1 | 8.1 | 7.6 | 6.9 |
  | `--amber` | 8.1 | 7.3 | 6.9 | 6.2 |
  | `--blue` | 5.8 | 5.2 | 4.9 | **4.4** |

  So `--pink` and `--blue` must not be used as text on `--bg-soft` (for
  example inside a hovered card). On accent fills use `--ink-on-accent`
  (7.1:1 on `--pink`); `--ink` on `--pink` is only 2.3:1 and is not allowed.
- **Labels:** every icon button has an accessible name that includes its
  target, for example *Preview take from 14:32*, *Show take from 14:32 in
  Finder*. The status region is a polite live region so state changes (ready,
  capturing, error) are announced once. The LiveFollowing indicator is a
  polite status too, so a change in Live's record state is announced.
- **Disabled controls explain themselves:** a disabled Record button carries
  a description (*Choose a camera to record*), and a missing file's disabled
  buttons are described by the *File missing* badge.
- **Colour is never the only signal:** each coloured state also has text or a
  glyph.

## Theme

**Dark only.** Live's UI is dark, so v1 has no light theme and does not follow
the OS appearance. Set `color-scheme: dark` so native controls and scrollbars
match.

## Copy guide

- The product term is **take**, never *clip* or *recording*. "Takes (3)",
  "Your takes will show up here".
- The plugin name is **ZVID Capture**.
- The record button labels are exactly **Record** and **Stop capturing**.
- Live's own buttons are *Record* in Live's words; say *in Live* rather than
  naming Arrangement or Session Record, since either arms capture.
- Use sentence case for labels, buttons and messages.
- Keep messages short and say what happened and what to do next.
- Times: capture timer `HH:MM:SS`; take duration `mm:ss`; transport position
  `Bar B.b.s` (for example `Bar 17.1.1`); resolution `1920×1080` with a
  multiplication sign; frame rate `30 fps`.
- Reference strings:

  | Where | Text |
  |---|---|
  | Status, no camera | No camera |
  | Status, ready | Ready to capture |
  | Status, error | Camera unavailable |
  | Preview empty | No camera selected |
  | Refresh | Refresh devices |
  | Permission link (macOS) | Open Privacy Settings |
  | Helper | Arm capture before you start playback or recording in Live. |
  | Helper, companion connected | Turn on Record in Live to arm capture. |
  | LiveFollowing | Following Live's record button |
  | LiveFollowing, armed | Record on in Live |
  | LiveFollowing, not armed | Record off in Live |
  | Take count | Takes follow transport: N |
  | Takes divider | Takes (N) |
  | Takes empty | Your takes will show up here |
  | Missing badge | File missing |
  | Unanchored badge | Not placed |
