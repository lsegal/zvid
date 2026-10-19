import type { Guide } from "./types";

export const editing: Guide = {
  id: "editing",
  title: "Editing and the timeline",
  accent: "amber",
  summary:
    "zvid splits your session into **Source Tracks**, where your material lives, and **Layers**, where you arrange windows onto it. Everything else, from range edits to the randomize wand, builds on that idea.",
  sections: [
    {
      id: "model",
      title: "Source Tracks and Layers",
      blocks: [
        {
          type: "figure",
          shot: "editing-overview",
          alt: "The zvid editor with the MIDI sample open: numbered layers at the top, source tracks below, the Audio row at the bottom and the preview on the right.",
          caption:
            "The MIDI sample: **Layers** at the top build the picture, **Source Tracks** below hold the material, and the **Audio** row at the bottom shows the mix.",
        },
        {
          type: "p",
          text: "**Source Tracks** hold your session's media, recordings and MIDI as source clips. Importing or recording puts material here, and each track has a number key (1–9) you'll use to arrange from it. Tracks pick their colors automatically, cycling through the palette in order.",
        },
        {
          type: "p",
          text: "**Layers** hold the arrangement. A layer clip is a **window onto a source track's time**, not a copy of one clip: it plays whatever the track holds in that window, piece by piece, and shows nothing where the track is empty. Layer 1 draws on top, and a new session starts with a single empty Layer 1.",
        },
        {
          type: "note",
          tone: "tip",
          text: "Because layer clips are windows, you can move, trim or replace source clips and your cut stays put. Only what the windows show changes.",
        },
        { type: "h3", text: "Overlaps" },
        {
          type: "p",
          text: "A layer shows one clip at a time. Placing, moving, pasting or committing a clip over others replaces what it covers. The same is true inside a source track: the later source clip wins.",
        },
        { type: "h3", text: "Showing and hiding" },
        {
          type: "list",
          items: [
            'Collapse the whole Layers or Source Tracks section with its header toggle. A collapsed Layers section reads "N layers hidden".',
            "Drag the separator under a row's label to resize it, up to four times its default height. Drag it all the way down, or double-click the label, to collapse the row.",
            "The **Audio** row at the bottom draws the mix. Double-click its label to collapse it; see [Audio and mixing](../audio/#metering).",
          ],
        },
      ],
    },
    {
      id: "clips",
      title: "Kinds of clips",
      blocks: [
        {
          type: "table",
          compact: true,
          head: ["Clip", "What it is", "How to make one"],
          rows: [
            [
              "Media",
              "Video, audio, images, animated GIF/WebP, Lottie `.json` and dotLottie `.lottie`.",
              "**File › Import Media**, or drop files on a source track.",
            ],
            [
              "MIDI",
              "Notes that play through an instrument on the clip.",
              "Right-click empty space on a source track › **Add MIDI Clip**.",
            ],
            [
              "Text",
              "A title with its own Text device. Double-click it in the preview to type.",
              "Selection menu › **Insert Text Clip**, or layer menu › **Insert text at playhead**.",
            ],
            [
              "Fill",
              "A solid or gradient color, painted by its Color device.",
              "Selection menu › **Insert Fill Clip**.",
            ],
            [
              "FX",
              "No picture of its own: its effects change everything beneath it while it plays. Shows an **FX** badge.",
              "Selection menu › **Insert FX Clip**, or layer menu › **Insert FX clip at playhead**.",
            ],
          ],
        },
        {
          type: "p",
          text: 'Clips inserted "at playhead" from the layer menu are four bars long. A new MIDI clip is up to one bar long, starts at the pointer (snapped to the grid), ends where the next clip begins, and comes with a Synth and a Gain ready to play. See [Instruments and MIDI](../audio/#instruments) for the piano roll.',
        },
        { type: "h3", text: "Clip properties" },
        {
          type: "p",
          text: "Selecting a source clip shows its **Clip** properties at the start of the FX panel: **Start**, **Length** and **Offset**. MIDI clips add **MIDI Length**, **Start Marker**, **Loop** and its **Loop Start** and **Loop End**, all in bars.beats.",
        },
      ],
    },
    {
      id: "selecting",
      title: "Selecting",
      blocks: [
        {
          type: "table",
          compact: true,
          head: ["To", "Do this"],
          rows: [
            ["Select a clip", "Click it. Selecting never moves the playhead."],
            [
              "Add or remove clips",
              "[[Shift]]-click. Layer clips and source clips can be mixed in one selection.",
            ],
            [
              "Select and jump to it",
              "[[⌘/Ctrl]]-click a layer clip. The playhead moves to its start.",
            ],
            [
              "Select a time range",
              "Drag across empty space on a layer. Double-click to select one grid cell.",
            ],
            [
              "Select by box",
              "Drag from empty space on a source track (Shift adds), or drag a range selection off its layer. Every clip the box touches is selected.",
            ],
            [
              "Pick a layer",
              "Click its header, or use [[↑]] and [[↓]] when no clip is selected.",
            ],
            ["Clear", "Press [[Esc]], or click empty space."],
          ],
        },
        {
          type: "p",
          text: 'A range selection shows as a dashed box reading "Press 1-9 to commit". Drag its body to move it or its edges to resize it. Releasing a click without dragging just moves the playhead.',
        },
        {
          type: "figure",
          shot: "editing-selection",
          alt: "A dashed range selection on a layer with its right-click menu open, showing Insert Track and its list of source tracks.",
          caption:
            "Right-click a range selection for **Selection actions**. **Insert Track** lists every source track with its number key.",
          width: 720,
        },
      ],
    },
    {
      id: "arranging",
      title: "Arranging",
      blocks: [
        { type: "h3", text: "Commit a window with 1–9" },
        {
          type: "p",
          text: "The fastest way to cut: select a range on a layer and press a number key. zvid drops a window onto that range showing source track N at the same time. Do it again on the next range with another key, and you're cutting between cameras like a switcher. **Insert Track** in the selection menu does the same thing (it's disabled where a track has no footage).",
        },
        {
          type: "steps",
          items: [
            "Drag across a stretch of Layer 1 to select it.",
            "Press [[1]] to fill it with source track 1, [[2]] for track 2, and so on.",
            "Select the next stretch and press another number.",
          ],
        },
        { type: "h3", text: "Send a whole source clip" },
        {
          type: "p",
          text: "[[⌘/Ctrl]]-click a source clip to drop it onto the arrangement at the same song position, on the last layer with room, or a new layer if none has. Or right-click it › **Copy to layer** and pick **Auto (last free layer)**, a specific layer, or **New layer**.",
        },
        {
          type: "figure",
          shot: "editing-copy-to-layer",
          alt: "A source clip's right-click menu with Copy to layer open, listing Auto (last free layer), each layer and New layer.",
          width: 640,
        },
        { type: "h3", text: "Edit clips" },
        {
          type: "table",
          compact: true,
          head: ["Edit", "How"],
          rows: [
            [
              "Move",
              "Drag a clip across time or onto another layer. Every selected clip moves together; source clips move in time only.",
            ],
            ["Trim", "Drag either edge."],
            [
              "Snap off for a moment",
              "Hold [[Shift]] while dragging or trimming.",
            ],
            [
              "Duplicate",
              "[[⌘/Ctrl]] + [[D]], or [[⌘/Ctrl]]-drag to drag out a copy.",
            ],
            [
              "Split",
              "[[⌘/Ctrl]] + [[E]] splits the selected layer clip at the playhead. Source clips split from their own menu.",
            ],
            [
              "Delete",
              "[[Delete]] or [[Backspace]]: the range selection first, then the selected clip, source clip or track.",
            ],
            [
              "Cut, copy, paste",
              "[[⌘/Ctrl]] + [[X]], [[C]], [[V]]. Cut and copy take the range selection when there is one. Paste lands at the playhead on the selected layer and overwrites what it covers. Effects travel with the clips.",
            ],
          ],
        },
        {
          type: "figure",
          shot: "editing-clip-menu",
          alt: "A layer clip's right-click menu: Jump to start, Cut, Copy, Paste, Duplicate, Split at playhead and Delete.",
          caption: "Right-click any clip for **Clip actions**.",
          width: 560,
        },
        { type: "h3", text: "Layers and tracks" },
        {
          type: "list",
          items: [
            "Add a layer with **+ Layer** below the layers, or **Insert layer above/below** from a layer's menu. Add a source track with **+ Track**, or drop media on the **New Source Track** row.",
            "Rename with **Rename…** or by double-clicking the name.",
            "Reorder by dragging the grip, by pressing [[Enter]] on the grip and using the arrow keys, or with **Move up** and **Move down**.",
            "The eye button hides a row's picture. The **fx** button bypasses its effects.",
            "**Lock source tracks** (the lock in the Source Tracks header) stops source clips being moved, trimmed or deleted while you arrange.",
          ],
        },
        {
          type: "figure",
          shot: "editing-layer-menu",
          alt: "A layer header's right-click menu with Rename, Duplicate, Delete, Disable FX, Add FX, Insert text at playhead, Insert FX clip at playhead, Insert layer above and below, and Move up and down.",
          width: 560,
        },
      ],
    },
    {
      id: "musical-timeline",
      title: "The musical timeline",
      blocks: [
        {
          type: "figure",
          shot: "editing-toolbar",
          alt: "The timeline toolbar: Tempo and Time scale buttons, Snap, the BPM control and the Time Sig control.",
          width: 720,
        },
        {
          type: "table",
          compact: true,
          head: ["Control", "What it does"],
          rows: [
            [
              "**Tempo / Time**",
              "Switches the ruler between bars and beats, and timecode.",
            ],
            [
              "**Snap**",
              "Snaps moves, trims and selections to the grid. On by default; hold [[Shift]] to bypass it for one drag.",
            ],
            [
              "**BPM**",
              "The session tempo, from 60 to 220. The − and + buttons step by 5.",
            ],
            [
              "**Time Sig**",
              "The time signature. The − and + buttons step from 1/1 to 12/8, including /3, /5 and /7 beats; or type any signature as N/M, such as 7/5, and press [[Enter]].",
            ],
            [
              "Grid",
              "Adapts to your zoom, from whole bars down to 1/32 notes. Snapping uses whatever the grid shows.",
            ],
          ],
        },
        { type: "h3", text: "Zoom and pan" },
        {
          type: "list",
          items: [
            "Zoom from 25% to 800% with **Zoom out**, **Zoom in** or the slider. Drag the percentage up and down to zoom, or hold the pointer still on it to type a zoom.",
            "Right-drag the ruler up and down to zoom, or sideways to pan. Middle-drag, or hold [[Space]] and drag, to pan anywhere.",
            "A left press on the ruler scrubs the playhead.",
          ],
        },
        { type: "h3", text: "Loops" },
        {
          type: "p",
          text: "Drag in the loop strip along the bottom of the ruler to choose a range, then press [[L]] (or double-click it) to lock it as the loop. Drag the loop's edges or middle to adjust it; double-click elsewhere in the strip to loop that bar; click once to clear. [[⌘/Ctrl]] + [[L]] loops the current range selection, or clears the loop. Right-click the strip for **Create loop in marker**, **Create loop out marker**, **Create loop area** and **Delete loop**.",
        },
        {
          type: "figure",
          shot: "editing-loop",
          alt: "The ruler with a locked loop region spanning about two bars.",
          width: 760,
        },
        { type: "h3", text: "Transport" },
        {
          type: "list",
          items: [
            "The outer buttons jump to the loop's start and end when there is one, otherwise the timeline's ([[⌘/Ctrl]] + [[←]] / [[→]]).",
            "The inner buttons jump back or forward half a bar, landing on the grid when Snap is on.",
            "[[⌘/Ctrl]]-click **Play** to play from the loop start. Playback wraps at the loop's out marker.",
            "The light beside the clock is yellow when stopped, green when playing and red when recording.",
          ],
        },
      ],
    },
    {
      id: "randomize",
      title: "Randomize arrangement",
      blocks: [
        {
          type: "video",
          id: "randomize",
          caption: "Two clicks of the wand, then play.",
        },
        {
          type: "p",
          text: "The wand in the transport (**Randomize arrangement**) throws out the current arrangement and builds a new one from your source tracks. It's a fast way to find a starting cut for performance videos and visualizers. On a session with no arrangement yet, the **Generate a sweet timeline** prompt does the same thing.",
        },
        {
          type: "list",
          items: [
            "It replaces every layer, with its clips and effects, with **Layer 1**, **Layer 2**, **Layer 3** and an **Audio** layer.",
            "Windows start on a quarter-bar grid, last from a quarter bar to two bars, and always sit inside real source footage.",
            "Layer 1 covers everywhere some video source has footage. Layer 2 starts a window at each step half the time, and Layer 3 a quarter of the time.",
            "The Audio layer is built from your audio-only sources. If one audio clip spans the whole length, it's used uncut.",
            "It stops at the session length if you've set one, otherwise at the end of the last video source.",
            "The whole rebuild is one undo step, so [[⌘/Ctrl]] + [[Z]] brings back what you had. Click again for another take.",
          ],
        },
      ],
    },
    {
      id: "menus",
      title: "Menus",
      blocks: [
        {
          type: "figure",
          shot: "editing-edit-menu",
          alt: "The Edit menu open, with Undo, Redo, Cut, Copy, Paste and submenus for the selected clip, layer and Audio.",
          width: 560,
        },
        {
          type: "table",
          compact: true,
          head: ["Menu", "Items"],
          rows: [
            [
              "**File**",
              "New Session · Open › Session… and Samples › Default, MIDI · Import Media · Locate Offline Media… · Media Storage… · Session Settings… · Connect to Share · Save · Export › Video…, Project…",
            ],
            [
              "**Edit**",
              "Undo and Redo, named after the change · Cut, Copy, Paste · submenus for the current **Selection**, **Clip**, **Layer** and **Audio**",
            ],
            [
              "**Help**",
              "Getting Started · Install Capture Plugin · Download Desktop App (in the desktop app: Check for Updates…)",
            ],
            [
              "Clip actions",
              "Jump to start · Cut · Copy · Paste · Duplicate · Split at playhead · Delete",
            ],
            ["Source clip actions", "The clip actions, plus Copy to layer"],
            [
              "Source track lane",
              "Actions for the track's selected clip, plus **Add MIDI Clip**",
            ],
            [
              "Selection actions",
              "Cut · Copy · Delete · Insert Track › each track · Insert Fill Clip · Insert Text Clip · Insert FX Clip · Clear selection",
            ],
            [
              "Layer header actions",
              "Rename… · Duplicate · Delete · Disable/Enable FX · Add FX · Insert text at playhead · Insert FX clip at playhead · Insert layer above/below · Move up/down",
            ],
            [
              "Source track actions",
              "Rename… · Duplicate · Delete · Move up · Move down",
            ],
          ],
        },
        {
          type: "p",
          text: "Press the [[Menu]] key or [[Shift]] + [[F10]] to open the menu for whatever's selected, without a mouse.",
        },
      ],
    },
    {
      id: "undo",
      title: "Undo and history",
      blocks: [
        {
          type: "p",
          text: "Every edit is one undo step, named after what it did: **Undo Move clip**, **Undo Split clip**, **Undo Create window**, **Undo Adjust BPM** and so on, as the Edit menu shows. A whole drag counts as one step. History is saved with your session, up to 100 steps, so it survives a reload.",
        },
      ],
    },
    {
      id: "shortcuts",
      title: "Keyboard shortcuts",
      blocks: [
        {
          type: "p",
          text: "Shortcuts don't fire while you're typing in a field.",
        },
        {
          type: "keys",
          rows: [
            {
              keys: ["Space"],
              action: "Play or pause (on release). Hold and drag to pan.",
            },
            {
              keys: ["⌘/Ctrl", "Space"],
              action: "Play from the loop's in marker",
            },
            { keys: ["⌘/Ctrl", "Z"], action: "Undo" },
            {
              keys: ["⌘/Ctrl", "Shift", "Z"],
              action: "Redo (also ⌘/Ctrl + Y)",
            },
            { keys: ["⌘/Ctrl", "X / C / V"], action: "Cut, copy, paste" },
            { keys: ["⌘/Ctrl", "D"], action: "Duplicate" },
            { keys: ["⌘/Ctrl", "E"], action: "Split at the playhead" },
            { keys: ["Delete"], action: "Delete (or Backspace)" },
            { keys: ["Esc"], action: "Clear the selection" },
            { keys: ["1–9"], action: "Commit the range to source track N" },
            { keys: ["←", "→"], action: "Step one frame (Shift: five)" },
            {
              keys: ["⌘/Ctrl", "← / →"],
              action: "Jump to loop markers, then timeline ends",
            },
            {
              keys: ["Home", "End"],
              action: "Start or last frame of the content",
            },
            { keys: ["↑", "↓"], action: "Select the layer above or below" },
            { keys: ["L"], action: "Lock the playback range as the loop" },
            { keys: ["⌘/Ctrl", "L"], action: "Set or clear the loop" },
            { keys: ["⌘/Ctrl", "S"], action: "Save to Sessions" },
            { keys: ["Shift", "F10"], action: "Open the context menu" },
          ],
        },
      ],
    },
  ],
};
