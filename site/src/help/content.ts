// Copy for the help landing page. Keep feature claims in step with the app:
// every item here should name something a user can find in zvid today.

// The four token colors, plus four help-only ones so every feature topic
// has its own color.
export type Accent =
  | "amber"
  | "pink"
  | "blue"
  | "mint"
  | "violet"
  | "cyan"
  | "orange"
  | "lime";

export type FeatureGroup = {
  title: string;
  items: string[];
};

export type Topic = {
  id: string;
  title: string;
  accent: Accent;
  summary: string;
  groups: FeatureGroup[];
};

export type Highlight = {
  title: string;
  body: string;
  accent: Accent;
};

export type Switcher = {
  id: string;
  app: string;
  intro: string;
  rows: { known: string; zvid: string }[];
};

export type Shortcut = { keys: string[]; action: string };

export const highlights: Highlight[] = [
  {
    title: "Your DAW is the camera",
    body: "Record camera takes with Ableton Live transport, then import supported arrangement timing and clips from the Live Set.",
    accent: "blue",
  },
  {
    title: "A timeline that counts in bars",
    body: "Switch the ruler between bars and beats or timecode, snap to a musical grid, and use tempo-synced motion on supported effects.",
    accent: "amber",
  },
  {
    title: "Effects that hear the music",
    body: "Reactive animation drives supported effect controls from the sound, so the picture can move with the music.",
    accent: "pink",
  },
  {
    title: "Edit together, live",
    body: "Share a link and edit the same session with collaborators. Missing media can transfer directly between peers.",
    accent: "mint",
  },
];

export type QuickStartPath = {
  id: string;
  title: string;
  steps: { title: string; body: string }[];
};

const arrangeAndExport = {
  title: "Arrange and export",
  body: "Drop takes from Source Tracks onto Layers, add FX, then choose File › Export › Video….",
};

export const quickStart: QuickStartPath[] = [
  {
    id: "from-live",
    title: "From Ableton Live",
    steps: [
      {
        title: "Add ZVID Capture",
        body: "Install it from Help › Install Capture Plugin, then add it to a track in Live 12 and pick your camera.",
      },
      {
        title: "Record while Live plays",
        body: "Press Record in the plugin, or in Live with the companion. Each pass from play to stop becomes a take.",
      },
      {
        title: "Open the Live Set",
        body: "Save the set, then choose File › Open › Session… in zvid and pick the .als file.",
      },
      arrangeAndExport,
    ],
  },
  {
    id: "record-in-zvid",
    title: "Record in zvid",
    steps: [
      {
        title: "Add a source track",
        body: "Click Track under Source Tracks, or drop media to start from.",
      },
      {
        title: "Pick your inputs",
        body: "Set a default camera and mic on the Record tab, or choose them on the track itself.",
      },
      {
        title: "Arm and record",
        body: "Click the track's record button, then Record in the transport. The take grows on the timeline as you go.",
      },
      arrangeAndExport,
    ],
  },
  {
    id: "from-media",
    title: "From media files",
    steps: [
      {
        title: "Bring in your media",
        body: "Choose File › Import Media, or try a sample from File › Open › Samples.",
      },
      {
        title: "Build the arrangement",
        body: "Drop takes from Source Tracks onto Layers, split with ⌘/Ctrl+E, and loop a section with L while you work.",
      },
      {
        title: "Add effects and motion",
        body: "Click FX on a layer or clip, then set an effect's Animation to Clip, Reactive or LFO to bring it to life.",
      },
      {
        title: "Export",
        body: "Choose File › Export › Video…, pick a preset, codec and range, and render straight from the app.",
      },
    ],
  },
];

export const topics: Topic[] = [
  {
    id: "ableton",
    title: "Ableton Live",
    accent: "blue",
    summary:
      "Film your performance while Live plays, then open the Live Set in zvid with every take where it belongs.",
    groups: [
      {
        title: "ZVID Capture plugin",
        items: [
          "VST3 for macOS and Windows, Audio Unit for macOS",
          "Records your camera in sync while Live 12 plays",
          "One take per pass from play to stop",
          "Built-in, USB, iPhone and phone webcams",
          "Hardware HEVC encoding, safe if Live quits mid-take",
          "Install it from Help › Install Capture Plugin",
        ],
      },
      {
        title: "Live companion",
        items: [
          "Optional control surface for Live",
          "Live's own Record buttons start and stop capture",
          "Takes are saved next to the set once it's saved",
        ],
      },
      {
        title: "Open a Live Set",
        items: [
          "File › Open › Session… opens an .als file",
          "Each clip plays the take recorded under it",
          "Tempo maps and tempo automation",
          "Warp markers, so video follows warped audio",
          "Loops unrolled onto the timeline",
          "In the desktop app, a mixdown WAV beside the set becomes the main audio",
        ],
      },
      {
        title: "After the import",
        items: [
          "Your tracks arrive as Source Tracks",
          "Build the edit on an empty Layer 1",
          "MIDI clips become placeholders you can link video to",
          "Missing takes show as offline and can be relinked",
        ],
      },
    ],
  },
  {
    id: "recording",
    title: "Recording on the timeline",
    accent: "pink",
    summary:
      "Record camera and microphone takes straight onto source tracks, in time with the session.",
    groups: [
      {
        title: "Arm and record",
        items: [
          "Arm one or more source tracks with their record buttons",
          "Record starts playback from the playhead, or joins it",
          "Press Record again to stop recording and keep playing",
          "Stopping playback stops the recording too",
        ],
      },
      {
        title: "Inputs",
        items: [
          "Set a default camera and mic on the Record tab",
          "Override them per track in its record device strip",
          "Arm several tracks to record several inputs at once",
        ],
      },
      {
        title: "Takes",
        items: [
          "Takes grow live with a filmstrip, a waveform and a REC badge",
          "Input level meters while you record",
          "Finished takes land in the session like imported media",
        ],
      },
    ],
  },
  {
    id: "video",
    title: "Video and compositing",
    accent: "cyan",
    summary:
      "A GPU compositor with stackable effects, on-canvas transforms, titles and transitions.",
    groups: [
      {
        title: "Clips and layers",
        items: [
          "Media clips for video and audio",
          "Text clips with on-canvas text editing",
          "Fill clips: solid, linear or radial gradient",
          "FX clips that apply effects to everything beneath them",
          "Effects on a clip, a layer, or the whole session (Global)",
        ],
      },
      {
        title: "Preview monitor",
        items: [
          "Move, resize, rotate and set the origin right on the canvas",
          "Program view plus a resizable Scopes panel",
          "Waveform, Parade, Vectorscope and Histogram scopes",
        ],
      },
      {
        title: "Color",
        items: [
          "Levels with Lift, Gamma, Gain and Offset wheels and a tone curve",
          "Exposure, Contrast and Colorize",
          "LUT with .cube import and eight built-in film looks",
        ],
      },
      {
        title: "Stylize and distort",
        items: [
          "Bloom, Gaussian Blur, Pixelate, Caustics, Refraction",
          "Analog Glitch, Digital Glitch, Negative Split",
          "Wave, Ripple, Twirl, Bulge, Fisheye and Turbulence distortion",
        ],
      },
      {
        title: "Layout and masking",
        items: [
          "Transform, Move with easing, and Zoom & Pan",
          "Order: vertical, horizontal or grid split-screens up to 6 × 6",
          "Shape masks: Rectangle, Oval, Star, Arrow or custom SVG",
          "Layer masks, additive or subtractive",
        ],
      },
      {
        title: "Text and transitions",
        items: [
          "Stroke, shadow, gradient fill, tracking, leading and resize to fit",
          "Bundled fonts, Google Fonts and your installed fonts",
          "32 transitions, including Dissolve, Push, Cube, Page Curl and Iris",
        ],
      },
    ],
  },
  {
    id: "motion",
    title: "Animation and modulation",
    accent: "violet",
    summary:
      "Animate supported effects with motion presets, audio-reactive drivers and tempo-synced LFOs.",
    groups: [
      {
        title: "Animation modes",
        items: [
          "Clip: In and Out motion with Linear or Ease curves",
          "Reactive: Bounce or Wobble driven by low and high frequency bands",
          "LFO: Sine, Triangle, Saw, Square or Random shapes",
        ],
      },
      {
        title: "Timing",
        items: [
          "Free rates from 0.05 to 20 Hz",
          "Tempo sync from 4 bars to 1/32, with dotted and triplet values",
          "Push and Squish entrances for split-screen layouts",
        ],
      },
      {
        title: "Audio modulation",
        items: [
          "Drive audio effect knobs from detected transients",
          "Or from a tempo-synced LFO",
          "Live trace graphs show exactly what each modulator is doing",
        ],
      },
    ],
  },
  {
    id: "editing",
    title: "Editing and the timeline",
    accent: "amber",
    summary:
      "Source Tracks hold your takes; Layers arrange windows onto them, so source edits never knock your cut out of place.",
    groups: [
      {
        title: "Arranging",
        items: [
          "Cut, copy, paste, duplicate and delete across ranges",
          "Split at the playhead and copy to any layer",
          "Commit a selection to a source track with 1–9",
          "Insert, reorder, rename and hide layers",
        ],
      },
      {
        title: "Musical timeline",
        items: [
          "Bars and beats or timecode ruler",
          "Tempo and time signature controls",
          "Adaptive grid from 1/1 to 1/32, with Shift to skip snapping",
          "Loop region and frame-accurate stepping",
        ],
      },
      {
        title: "Randomize arrangement",
        items: [
          "One click builds a multi-layer cut from your source takes",
          "Adds a matching Audio layer",
          "A fast starting point for performance videos and visualizers",
        ],
      },
    ],
  },
  {
    id: "audio",
    title: "Audio and mixing",
    accent: "mint",
    summary:
      "A clip, layer and master effect chain with the same processing in playback and export.",
    groups: [
      {
        title: "Signal flow",
        items: [
          "Clip → layer → Global master → soft limiter",
          "Smooth parameter ramps, crossfaded bypass and latency compensation",
          "Playback and export share one processing engine",
        ],
      },
      {
        title: "Tone and dynamics",
        items: [
          "Gain with Mute, 3-band EQ",
          "High Cut and Low Cut at 12 or 24 dB/oct with resonance",
          "Compressor with parallel Mix, Limiter with lookahead",
          "Noise Gate, De-Ess and Transient Shaper",
        ],
      },
      {
        title: "Color and space",
        items: [
          "Saturation and Bitcrush",
          "Delay, Reverb, Chorus, Phaser, Tremolo and Auto-Pan",
          "Stereo, Mono and Reverse",
        ],
      },
      {
        title: "Metering",
        items: [
          "VU meters with peak hold and clip indicators",
          "Master spectrogram in the audio analysis pane",
          "Waveforms on clips and a mix waveform under the timeline",
        ],
      },
    ],
  },
  {
    id: "collaboration",
    title: "Collaboration and projects",
    accent: "orange",
    summary:
      "Edit together in real time, keep media on your own machine, and carry whole projects in one file.",
    groups: [
      {
        title: "Live collaboration",
        items: [
          "Share a link to co-edit with live cursors",
          "Missing media syncs directly between collaborators",
          "Media Sync Status shows progress and retries",
        ],
      },
      {
        title: "Sessions",
        items: [
          "Autosave with undo history that survives a reload",
          "Sessions library with rename, duplicate and delete",
          "Export a .zvd project with all of its media",
          "Locate Offline Media to relink moved files",
        ],
      },
      {
        title: "Web and desktop",
        items: [
          "Runs in the browser, nothing to install",
          "Optional desktop app with native file access",
          "Media stays in local storage you control from Media Storage…",
        ],
      },
    ],
  },
  {
    id: "export",
    title: "Export",
    accent: "lime",
    summary:
      "Render locally with device-supported video encoders, without an upload queue.",
    groups: [
      {
        title: "Video",
        items: [
          "H.264, HEVC, AV1, VP8 and VP9, or Auto",
          "16:9, 9:16, 1:1, 4K, 720p or custom sizes",
          "23.976 to 60 fps",
          "Low, Medium, High or custom bitrate",
        ],
      },
      {
        title: "Audio and range",
        items: [
          "AAC in MP4 or Opus in WebM",
          "128 to 320 kbps at 44.1 or 48 kHz",
          "Export the whole session or an In/Out range",
        ],
      },
    ],
  },
];

export const switchers: Switcher[] = [
  {
    id: "live",
    app: "Ableton Live",
    intro:
      "zvid thinks in bars and beats, and it opens your Live Sets directly.",
    rows: [
      {
        known: "Arrangement View",
        zvid: "Layers on a bars and beats timeline",
      },
      {
        known: "Warp markers and tempo automation",
        zvid: "Kept when you open a .als set",
      },
      {
        known: "Device chain",
        zvid: "FX stack with Bypass and Move Left/Right",
      },
      {
        known: "LFO with sync, dotted and triplet rates",
        zvid: "LFO animation and modulation on supported effects",
      },
      {
        known: "Loop brace",
        zvid: "Loop region, set from a selection with L",
      },
      {
        known: "Audio and video tracks",
        zvid: "ZVID Capture records camera takes inside Live",
      },
    ],
  },
  {
    id: "logic",
    app: "Logic Pro",
    intro: "Recording and mixing work the way you expect.",
    rows: [
      { known: "Track record-enable", zvid: "Record arm on each source track" },
      { known: "Takes", zvid: "Takes on Source Tracks, arranged on Layers" },
      {
        known: "Channel EQ and Compressor",
        zvid: "EQ, High Cut, Low Cut and Compressor",
      },
      { known: "Stereo Out", zvid: "Global master chain with a soft limiter" },
      { known: "Track effects", zvid: "Clip, layer, and master effect chains" },
    ],
  },
  {
    id: "premiere",
    app: "Premiere Pro",
    intro: "Effects, color and export will feel familiar.",
    rows: [
      { known: "Adjustment layers", zvid: "FX clips" },
      { known: "Effect Controls", zvid: "FX stack on a clip or layer" },
      {
        known: "Color wheels and curves",
        zvid: "Levels: Lift, Gamma, Gain, Offset and tone curve",
      },
      { known: "Creative LUTs", zvid: "LUT effect with .cube import" },
      { known: "Add Edit", zvid: "Split at playhead (⌘/Ctrl+E)" },
      {
        known: "Export with In/Out",
        zvid: "Export › Video… with an In/Out range",
      },
    ],
  },
  {
    id: "resolve",
    app: "DaVinci Resolve",
    intro: "Scopes, color tools and a clear signal chain are all here.",
    rows: [
      {
        known: "Video scopes",
        zvid: "Waveform, Parade, Vectorscope and Histogram",
      },
      {
        known: "Primaries wheels",
        zvid: "Levels: Lift, Gamma, Gain and Offset",
      },
      { known: "Fairlight FX", zvid: "Clip, layer and Global audio effects" },
      { known: "Bus and master", zvid: "Clip → layer → master chain" },
      {
        known: "Beat markers",
        zvid: "Reactive animation that follows the beat",
      },
    ],
  },
  {
    id: "fcp",
    app: "Final Cut Pro",
    intro: "Get going fast with ready-made looks and on-canvas controls.",
    rows: [
      { known: "Transitions browser", zvid: "32 transition types" },
      {
        known: "Transform in the viewer",
        zvid: "On-canvas move, resize and rotate",
      },
      { known: "Titles", zvid: "Text clips edited right on the canvas" },
      {
        known: "Vertical and square versions",
        zvid: "9:16 and 1:1 export presets",
      },
      { known: "Color presets", zvid: "Eight built-in film-look LUTs" },
    ],
  },
];

export const shortcuts: Shortcut[] = [
  { keys: ["Space"], action: "Play or stop" },
  { keys: ["⌘/Ctrl", "E"], action: "Split at playhead" },
  { keys: ["⌘/Ctrl", "D"], action: "Duplicate" },
  { keys: ["⌘/Ctrl", "Z"], action: "Undo" },
  { keys: ["⌘/Ctrl", "Shift", "Z"], action: "Redo" },
  { keys: ["⌘/Ctrl", "X / C / V"], action: "Cut, copy, paste" },
  { keys: ["Delete"], action: "Delete selection" },
  { keys: ["←", "→"], action: "Step one frame (Shift: five)" },
  { keys: ["⌘/Ctrl", "← / →"], action: "Jump to loop markers, then ends" },
  { keys: ["Home", "End"], action: "Jump to content start or end" },
  { keys: ["↑", "↓"], action: "Select layer" },
  { keys: ["L"], action: "Loop the selection" },
  { keys: ["1–9"], action: "Commit selection to a source track" },
  { keys: ["Esc"], action: "Clear selection" },
];

export const formats = [
  {
    title: "Open",
    items: [
      ".zvd project archives",
      ".als Ableton Live Sets",
      "project.json sessions",
    ],
  },
  {
    title: "Import",
    items: [
      "Video: MP4, MOV, MKV, WebM, AVI",
      "Audio: WAV, MP3, M4A, FLAC, AIFF, Opus, Ogg",
      "SVG shapes and .cube LUTs",
    ],
  },
  {
    title: "Export",
    items: [
      "MP4: H.264, HEVC or AV1 with AAC",
      "WebM: VP8 or VP9 with Opus",
      ".zvd project with media",
    ],
  },
];

export type Demo = {
  id: string;
  title: string;
  body: string;
  // The clip's frame size, so the page reserves its space before it loads.
  width: number;
  height: number;
};

// Short silent screen recordings, in public/videos. The recording clip uses
// Chromium's fake camera and microphone; the rest use the MIDI sample.
export const demos: Demo[] = [
  {
    id: "record-take",
    title: "Record a take on the timeline",
    body: "Add a source track, arm it and press Record. The take grows from the playhead with a live filmstrip and waveform, then lands in the session.",
    width: 1280,
    height: 800,
  },
  {
    id: "piano-roll",
    title: "Edit MIDI in the piano roll",
    body: "Select a MIDI clip to open its notes, velocities and instrument. The Drums play the Drum Rack's TR-808 bank, then the Bass opens its Synth.",
    width: 1280,
    height: 712,
  },
  {
    id: "reactive-fx",
    title: "Make effects react to the music",
    body: "Add Bloom to the Global stack and switch its Animation to Reactive. It flares on every hit.",
    width: 1280,
    height: 800,
  },
  {
    id: "transform",
    title: "Transform on the canvas",
    body: "Drag to move, pull a handle to resize and swing the rotation handle. The Transform device follows along.",
    width: 1110,
    height: 804,
  },
  {
    id: "scopes",
    title: "Check the picture with scopes",
    body: "Waveform, Vectorscope, Parade and Histogram update live while the session plays.",
    width: 800,
    height: 440,
  },
  {
    id: "arrangement",
    title: "Play the arrangement",
    body: "Layers stack media, text and FX clips over the source tracks while the MIDI sample plays.",
    width: 1280,
    height: 800,
  },
  {
    id: "randomize",
    title: "Randomize the arrangement",
    body: "The wand rebuilds the layers from random windows into your source tracks. Click again for another take.",
    width: 1280,
    height: 800,
  },
];
