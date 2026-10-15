// Landing page copy. Each slide fills the screen; feature slides pair a
// headline with a fast-cut loop from public/videos.

export type Accent =
  | "amber"
  | "pink"
  | "blue"
  | "mint"
  | "violet"
  | "cyan"
  | "orange"
  | "lime";

export type FeatureSlide = {
  id: string;
  accent: Accent;
  kicker: string;
  title: string;
  body: string;
  chips: string[];
  video: string;
  // The help guide that covers this feature.
  guide: string;
};

export const features: FeatureSlide[] = [
  {
    id: "timeline",
    accent: "amber",
    kicker: "Bars, not frames",
    title: "A timeline that counts in bars.",
    body: "The ruler knows your tempo and time signature, the grid snaps down to 1/32 notes, and one key locks a loop. Cut between takes like a live switcher: select a range, press 1–9.",
    chips: ["Tempo-aware ruler", "Snap to the beat", "Cut with 1–9"],
    video: "timeline",
    guide: "editing",
  },
  {
    id: "reactive",
    accent: "violet",
    kicker: "No keyframes",
    title: "Effects that hear the music.",
    body: "Set any effect to Reactive and it kicks on every hit. Or lock an LFO to the tempo, from four bars down to 1/32. The picture moves with the track, and keeps moving when you change the edit.",
    chips: ["Reactive", "Tempo-synced LFO", "Clip in and out"],
    video: "reactive",
    guide: "motion",
  },
  {
    id: "daw",
    accent: "blue",
    kicker: "Ableton Live",
    title: "Your DAW is the camera.",
    body: "ZVID Capture films you while Live plays, one take per pass, in sync with the transport. Open the Live Set in zvid and every take lands exactly where you played it.",
    chips: ["VST3 and Audio Unit", "Live 12", "Warp-aware import"],
    video: "daw",
    guide: "ableton",
  },
  {
    id: "midi",
    accent: "mint",
    kicker: "Instruments built in",
    title: "Write the music, too.",
    body: "MIDI clips with a piano roll and velocity lane. A Drum Rack with TR-808, TR-909, CR-78 and 8-Bit kits, a Synth, a Granular engine and an Arpeggiator, plus twenty-two audio effects to mix it all.",
    chips: ["Piano roll", "Drum Rack", "22 audio effects"],
    video: "midi",
    guide: "audio",
  },
  {
    id: "record",
    accent: "pink",
    kicker: "Hit record",
    title: "Record straight onto the timeline.",
    body: "Arm a track, press Record, and watch the take grow in time with your session. Arm several and every camera and mic records in the same pass.",
    chips: ["Multi-track", "Per-track inputs", "Live preview"],
    video: "record",
    guide: "recording",
  },
  {
    id: "compositing",
    accent: "cyan",
    kicker: "GPU compositing",
    title: "A real compositor, not a toy.",
    body: "Effects on every clip, layer and frame. Grade with color wheels and LUTs, cut with 32 transitions, build split-screens and masks, and transform right on the canvas, with scopes to check your work.",
    chips: ["Levels and LUTs", "32 transitions", "Scopes"],
    video: "compositing",
    guide: "video",
  },
  {
    id: "randomize",
    accent: "amber",
    kicker: "The wand",
    title: "A first cut in one click.",
    body: "The wand builds a multi-layer arrangement from your takes, always inside real footage and always on the beat. Not feeling it? Click again.",
    chips: ["Multi-layer", "On the grid", "One undo step"],
    video: "randomize",
    guide: "editing",
  },
  {
    id: "collab",
    accent: "orange",
    kicker: "Multiplayer",
    title: "Edit together, live.",
    body: "Share a link and work in the same session at the same time, with everyone's cursor on screen. Media goes peer to peer; zvid's servers never see your project.",
    chips: ["Share a link", "Live cursors", "Peer-to-peer media"],
    video: "collab",
    guide: "collaboration",
  },
  {
    id: "export",
    accent: "lime",
    kicker: "Ship it",
    title: "Export on your own machine.",
    body: "H.264, HEVC and AV1, accelerated by your hardware, right in the browser. No uploads, no render queue, and the mix you hear is the mix you get.",
    chips: ["No upload", "4K presets", "MP4 or WebM"],
    video: "export",
    guide: "export",
  },
];

export const homes = [
  { app: "Ableton Live", note: "Live Sets, warp markers, tempo-synced LFOs" },
  { app: "Logic Pro", note: "Record-arm, takes, channel EQ and dynamics" },
  { app: "Premiere Pro", note: "Adjustment clips, Lumetri-style wheels, LUTs" },
  {
    app: "DaVinci Resolve",
    note: "Scopes, color wheels, a clear signal chain",
  },
  { app: "Final Cut Pro", note: "On-canvas transforms, ready-made looks" },
];
