// Writes the zvid MIDI sample: the editable session template
// `src/sample/zvid-midi.project.json` and its asset manifest
// `src/sample/midi-manifest.generated.ts`, hashed from the media in
// `public/samples/midi-v1`.
//
//   node app/scripts/sample/build-midi-sample.mjs [--check]
//
// `--check` fails when either file doesn't match what would be written.
//
// A 12-bar electro track in D major, 120 BPM, whose every sound is
// generated: MIDI clips play through a Drum Rack (its banks are
// synthesized, see scripts/gen-drum-banks.mjs), Synths, an Arpeggiator and a
// Granular (whose grains read a built-in tone), each with audio effects
// stacked after it. No clip plays recorded audio. The picture is two
// LottieFiles animations: Forest Morning, and a second Forest Morning below
// it that rises in half a beat behind every two-bar phrase and leaves with
// it, over Gradient Dots.
//
// Times are in quarter notes. At 120 BPM and 24 fps a quarter is 12 frames,
// so the half-beat echo lands on a whole frame.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE_VERSION = "midi-v1";
const MEDIA_DIR = resolve(APP, "public/samples", SAMPLE_VERSION);
const SESSION_FILE = resolve(APP, "src/sample/zvid-midi.project.json");
const MANIFEST_FILE = resolve(APP, "src/sample/midi-manifest.generated.ts");

const FPS = 24;
const BPM = 120;
const WIDTH = 1920;
const HEIGHT = 1080;
const BARS = 12;
const BAR = 4;
const LENGTH = BARS * BAR;

const LIGHT = "rgba(244,247,236,1)";
const LEAF = "rgba(196,236,170,1)";

const samplePath = (name) => `zvid-sample://${SAMPLE_VERSION}/${name}`;
const frames = (quarters) => Math.round((quarters * 60 * FPS) / BPM);

const LOTTIE_CREDIT = (title) =>
  `"${title}" from LottieFiles (lottiefiles.com), free under the Lottie ` +
  "Simple License; supplied for this sample in issue #1415.";
const ICON_CREDIT = "The zvid logo, zvid's own artwork.";

const FOREST = { key: "forest", file: "forest-morning.lottie" };
const DOTS = { key: "dots", file: "gradient-dots.lottie" };
const ICON = { key: "zvid-logo", file: "zvid-logo.svg" };

// Layers, top first: the titles, the logo, Forest Morning, its echo below
// it, and Gradient Dots behind everything. The MIDI plays from source
// tracks: with no layer clip holding audio, every source clip that sounds
// is in the mix.
const LAYERS = [
  { id: "titles", name: "Titles" },
  { id: "logo", name: "zvid logo" },
  { id: "forest", name: "Forest Morning" },
  { id: "forest-echo", name: "Forest Morning · echo" },
  { id: "dots", name: "Gradient Dots" },
];

// ---- effects -------------------------------------------------------------

const effects = [];

function param(value) {
  return typeof value === "number"
    ? { floatValue: value }
    : { stringValue: value };
}

function addEffect(trackId, effectName, parameters, extra = {}) {
  effects.push({
    id: `midi-fx-${String(effects.length + 1).padStart(3, "0")}`,
    trackId,
    effectName,
    parameters: Object.fromEntries(
      Object.entries(parameters).map(([key, value]) => [key, param(value)]),
    ),
    ...extra,
  });
}

const clipTrack = (clipId) => `clip:${clipId}`;
const sourceClipTrack = (clipId) => `source-clip:source-${clipId}`;

function transformValues(prefix, values) {
  return {
    [`${prefix}PositionX`]: values.x ?? 0,
    [`${prefix}PositionY`]: values.y ?? 0,
    [`${prefix}ScaleX`]: values.scaleX ?? values.scale ?? 1,
    [`${prefix}ScaleY`]: values.scaleY ?? values.scale ?? 1,
    [`${prefix}OriginX`]: 0,
    [`${prefix}OriginY`]: 0,
    [`${prefix}Rotation`]: 0,
  };
}

const fadeIn = (timing = "Fast") => ({
  enabled: true,
  mode: "clip",
  clip: { motionIn: "Ease Out", motionOut: "None", timing },
});

// ---- music ---------------------------------------------------------------

// General MIDI drum notes, which the Drum Rack's pads play from note 36.
const KICK = 36;
const RIM = 37;
const CLAP = 39;
const CLOSED_HAT = 42;
const OPEN_HAT = 46;
const CRASH = 49;
const TOMS = [50, 48, 45, 43];

// I–vi–IV–V in D major, one chord a bar: D, Bm, G, A.
const PROGRESSION = [
  { root: 38, triad: [62, 66, 69] },
  { root: 35, triad: [59, 62, 66] },
  { root: 31, triad: [55, 59, 62] },
  { root: 33, triad: [57, 61, 64] },
];
const chordAt = (bar) => PROGRESSION[bar % PROGRESSION.length];

const note = (pitch, start, length, velocity = 100) => ({
  pitch,
  start,
  length,
  velocity,
});

// Bars 1–2 are hats and a clap pickup, bars 3–12 the electro beat: the kick
// on one, the "a" of two and the "and" of three, claps on two and four,
// sixteenth hats accented on the beat and an open hat on the "and" of four,
// which the next closed hat chokes. Bar 8 ends in a tom fill into a crash.
function drumNotes() {
  const notes = [];
  for (let bar = 0; bar < BARS; bar += 1) {
    const at = bar * BAR;
    for (let step = 0; step < 16; step += 1) {
      if (bar >= 2 && step === 14) {
        continue;
      }
      notes.push(
        note(CLOSED_HAT, at + step / 4, 0.25, step % 4 === 0 ? 96 : 64),
      );
    }
    if (bar < 2) {
      if (bar === 1) {
        notes.push(note(CLAP, at + 3, 0.5, 90), note(CLAP, at + 3.5, 0.5, 110));
      }
      continue;
    }
    notes.push(note(OPEN_HAT, at + 3.5, 0.5, 80));
    for (const beat of [0, 1.75, 2.5]) {
      notes.push(note(KICK, at + beat, 0.5, beat === 0 ? 127 : 108));
    }
    const fill = bar === 7;
    notes.push(note(CLAP, at + 1, 0.5, 112));
    if (fill) {
      TOMS.forEach((tom, index) =>
        notes.push(note(tom, at + 3 + index / 4, 0.25, 96 + index * 8)),
      );
    } else {
      notes.push(note(CLAP, at + 3, 0.5, 112));
    }
    if (bar >= 8) {
      notes.push(note(RIM, at + 2.25, 0.25, 84));
    }
    if (bar === 2 || bar === 8) {
      notes.push(note(CRASH, at, 1, 110));
    }
  }
  return notes;
}

// From bar 3, an octave-jumping sixteenth line on each chord's root.
const BASS_STEPS = [
  [0, 0.5, 0],
  [0.75, 0.25, 12],
  [1.5, 0.5, 0],
  [2, 0.25, 0],
  [2.75, 0.25, 12],
  [3.25, 0.25, 0],
  [3.5, 0.5, 7],
];
function bassNotes() {
  const notes = [];
  for (let bar = 2; bar < BARS; bar += 1) {
    const { root } = chordAt(bar);
    for (const [beat, length, interval] of BASS_STEPS) {
      notes.push(
        note(root + interval, (bar - 2) * BAR + beat, length, beat ? 96 : 120),
      );
    }
  }
  return notes;
}

// Each bar's triad held for the Arpeggiator to walk.
function chordNotes(velocity, octave = 0) {
  return Array.from({ length: BARS }, (_, bar) =>
    chordAt(bar).triad.map((pitch) =>
      note(pitch + octave * 12, bar * BAR, BAR, velocity),
    ),
  ).flat();
}

// Bars 9–12: a lead over the last pass of the chords, home on D.
const LEAD = [
  [69, 0, 0.5],
  [74, 0.5, 0.5],
  [73, 1, 0.5],
  [74, 1.5, 1],
  [76, 2.5, 0.5],
  [78, 3, 1],
  [78, 4, 0.5],
  [76, 4.5, 0.5],
  [74, 5, 1],
  [71, 6, 1],
  [74, 7, 1],
  [71, 8, 0.5],
  [74, 8.5, 0.5],
  [79, 9, 1],
  [78, 10, 0.5],
  [76, 10.5, 0.5],
  [74, 11, 1],
  [73, 12, 1],
  [76, 13, 1],
  [74, 14, 2],
];
const leadNotes = () =>
  LEAD.map(([pitch, start, length]) => note(pitch, start, length, 100));

const sourceTracks = [];
const spans = [];

// A source track holding one MIDI clip from bar `fromBar` to the end,
// playing `notes` through `instrument` and then `chain`, each an
// [effectName, parameters] pair, after a Gain at `gainDb`.
function midiTrack({ key, name, fromBar, notes, gainDb, instrument, chain }) {
  sourceTracks.push({ id: `source-${key}`, name, colorIndex: spans.length });
  spans.push({
    id: key,
    trackId: `source-${key}`,
    name,
    frameStart: frames(fromBar * BAR),
    frameCount: frames(LENGTH - fromBar * BAR),
    clipStart: 0,
    frameOffset: 0,
    filePath: "",
    notes,
  });
  const stack = sourceClipTrack(key);
  for (const [effectName, parameters] of instrument) {
    addEffect(stack, effectName, parameters);
  }
  addEffect(stack, "Gain", { Gain: gainDb, Mute: 0 });
  for (const [effectName, parameters] of chain) {
    addEffect(stack, effectName, parameters);
  }
}

const synth = (parameters) => [
  "Synth",
  {
    Wave: "Saw",
    Octave: 0,
    Detune: 0,
    Cutoff: 2400,
    Resonance: 1,
    Attack: 0.005,
    Decay: 0.15,
    Sustain: 0.6,
    Release: 0.2,
    ...parameters,
  },
];

midiTrack({
  key: "drums",
  name: "Drums",
  fromBar: 0,
  notes: drumNotes(),
  gainDb: -2,
  instrument: [
    ["Drum Rack", { Pads: JSON.stringify({ bank: "builtin:tr-808", pads: {} }) }],
  ],
  chain: [
    [
      "Compressor",
      {
        Threshold: -18,
        Ratio: 4,
        Attack: 5,
        Release: 80,
        Knee: 3,
        Makeup: 4,
        Mix: 1,
      },
    ],
    ["Saturation", { Drive: 6, Type: "Tape", Tone: 9000, Output: -3, Mix: 0.6 }],
  ],
});

midiTrack({
  key: "bass",
  name: "Bass",
  fromBar: 2,
  notes: bassNotes(),
  gainDb: -6,
  instrument: [
    synth({
      Wave: "Square",
      Cutoff: 700,
      Resonance: 6,
      Decay: 0.12,
      Sustain: 0.4,
      Release: 0.05,
    }),
  ],
  chain: [
    ["Saturation", { Drive: 12, Type: "Tape", Tone: 5000, Output: -6, Mix: 1 }],
    ["Low Cut", { Frequency: 35, Resonance: 0.7, Slope: "24 dB/oct" }],
  ],
});

midiTrack({
  key: "arp",
  name: "Arp",
  fromBar: 0,
  notes: chordNotes(84),
  gainDb: -14,
  instrument: [
    ["Arpeggiator", { Rate: "1/16", Pattern: "Up-Down", Octaves: 2 }],
    synth({
      Cutoff: 3200,
      Resonance: 4,
      Decay: 0.1,
      Sustain: 0.2,
      Release: 0.08,
    }),
  ],
  chain: [
    [
      "Delay",
      {
        Sync: "On",
        Note: "1/8D",
        Feedback: 0.35,
        "Ping-pong": "On",
        "High cut": 6000,
        Mix: 0.3,
      },
    ],
    ["Auto Pan", { Sync: "On", Note: "1/2", Depth: 0.6, Shape: "Sine" }],
  ],
});

midiTrack({
  key: "pad",
  name: "Granular pad",
  fromBar: 0,
  notes: chordNotes(72),
  gainDb: -12,
  instrument: [
    [
      "Granular",
      {
        "Grain Size": 0.12,
        Density: 40,
        Transpose: 0,
        Position: 0.4,
        Spray: 0.35,
        Attack: 0.4,
        Release: 1.2,
        Cutoff: 4000,
        Resonance: 1,
      },
    ],
  ],
  chain: [
    [
      "Chorus",
      { Rate: 0.8, Depth: 0.6, Delay: 20, Feedback: 0.2, Spread: 1, Mix: 0.5 },
    ],
    [
      "Phaser",
      { Rate: 0.25, Depth: 70, Stages: "8", Center: 900, Feedback: 40, Mix: 35 },
    ],
    [
      "Reverb",
      { Decay: 4, "Pre-delay": 20, Size: 0.8, Damping: 7000, Mix: 0.4 },
    ],
  ],
});

midiTrack({
  key: "lead",
  name: "Lead",
  fromBar: 8,
  notes: leadNotes(),
  gainDb: -12,
  instrument: [
    synth({
      Wave: "Square",
      Detune: 7,
      Cutoff: 2600,
      Resonance: 2,
      Attack: 0.01,
      Decay: 0.2,
      Sustain: 0.5,
      Release: 0.25,
    }),
  ],
  chain: [
    ["Tremolo", { Sync: "On", Note: "1/16", Depth: 0.3, Shape: "Sine" }],
    [
      "Delay",
      {
        Sync: "On",
        Note: "1/8D",
        Feedback: 0.4,
        "Ping-pong": "Off",
        "High cut": 5000,
        Mix: 0.25,
      },
    ],
    [
      "Reverb",
      { Decay: 3, "Pre-delay": 30, Size: 0.7, Damping: 6000, Mix: 0.35 },
    ],
  ],
});

// ---- pictures ------------------------------------------------------------

// Each Lottie is a source track holding one clip that loops it across the
// whole project; the layers play it as selections.
for (const [index, picture] of [
  [0, { ...FOREST, name: "Forest Morning" }],
  [1, { ...DOTS, name: "Gradient Dots" }],
]) {
  sourceTracks.push({
    id: `source-${picture.key}`,
    name: picture.name,
    colorIndex: spans.length + index,
    recordings: [{ filename: samplePath(picture.file) }],
  });
}
for (const picture of [
  { ...FOREST, name: "Forest Morning" },
  { ...DOTS, name: "Gradient Dots" },
]) {
  spans.push({
    id: `span-${picture.key}`,
    trackId: `source-${picture.key}`,
    name: picture.name,
    frameStart: 0,
    frameCount: frames(LENGTH),
    clipStart: 0,
    frameOffset: 0,
    filePath: samplePath(picture.file),
  });
}

const selections = [];

// Places `picture` on `layerId` from `start` for `length` quarters, playing
// it `lag` quarters behind the timeline. Returns the clip's stack.
function place(layerId, picture, start, length, lag = 0) {
  const id = selections.length + 1;
  selections.push({
    id,
    trackId: `source-${picture.key}`,
    mainTrackId: layerId,
    frameStart: frames(start),
    frameEnd: frames(start + length),
    sourceClipId: `span-${picture.key}`,
    sourceOffsetSeconds: -frames(lag) / FPS,
  });
  return clipTrack(`selection-${id}`);
}

const FOREST_PLACE = { y: -0.1, scale: 0.78 };
const ECHO_PLACE = { y: 0.22, scale: 0.78 };

place("dots", DOTS, 0, LENGTH);
addEffect(place("forest", FOREST, 0, LENGTH), "Transform", {
  ...transformValues("", FOREST_PLACE),
});
// Every two-bar phrase, the echo rises in from below the frame half a beat
// after the downbeat, playing Forest Morning half a beat behind, so its
// layers drift against the ones above, then leaves with the phrase.
const ECHO_LAG = 0.5;
for (let phrase = 0; phrase < BARS / 2; phrase += 1) {
  const start = phrase * 2 * BAR + ECHO_LAG;
  addEffect(
    place("forest-echo", FOREST, start, 2 * BAR - ECHO_LAG, ECHO_LAG),
    "Move",
    {
      Motion: "Ease Out",
      ...transformValues("Start", { ...ECHO_PLACE, y: 0.75 }),
      ...transformValues("End", ECHO_PLACE),
    },
  );
}

// ---- titles --------------------------------------------------------------

const layerClips = { fills: [], texts: [] };

function layerClip(kind, id, layerId, start, length) {
  layerClips[kind].push({
    id,
    mainTrackId: layerId,
    frameStart: frames(start),
    frameEnd: frames(start + length),
  });
  return clipTrack(id);
}

function text(id, start, length, style, y) {
  const stack = layerClip("texts", id, "titles", start, length);
  addEffect(
    stack,
    "Text",
    {
      FontFamily: "Inter",
      FontWeight: "Bold",
      FontStyle: "",
      Align: "Center",
      VerticalAlign: "Middle",
      ResizeToFit: "Off",
      FillMode: "Solid",
      Color: LIGHT,
      Stroke: "rgba(0,0,0,0)",
      Shadow: "On",
      LineHeight: 1.1,
      LetterSpacing: 0,
      StrokeWidth: 0,
      Padding: 0,
      ...style,
    },
    { animation: fadeIn() },
  );
  addEffect(stack, "Transform", transformValues("", { y }));
}

text("text-midi", 0, 2 * BAR, { Text: "MIDI", FontSize: 220 }, -0.08);
text(
  "text-generated",
  BAR,
  BAR,
  { Text: "every sound generated", FontWeight: "Regular", FontSize: 56, Color: LEAF },
  0.12,
);

// Bars 11–12: the zvid logo and wordmark close the sample.
const ICON_ASPECT = 258 / 212;
const logo = layerClip("fills", "fill-logo", "logo", 10 * BAR, 2 * BAR);
addEffect(logo, "Color", { Mode: "Solid", Color: LIGHT, Opacity: 1 });
addEffect(logo, "Shape", { Shape: `Custom:${samplePath(ICON.file)}` });
const LOGO_HEIGHT = 0.3;
addEffect(
  logo,
  "Transform",
  transformValues("", {
    y: -0.12,
    scaleX: (LOGO_HEIGHT * ICON_ASPECT * HEIGHT) / WIDTH,
    scaleY: LOGO_HEIGHT,
  }),
  { animation: fadeIn() },
);
text("text-zvid", 10 * BAR, 2 * BAR, { Text: "zvid", FontSize: 160 }, 0.18);

// ---- session -------------------------------------------------------------

const session = {
  mainTracks: LAYERS.map((layer, index) => ({
    id: layer.id,
    name: layer.name,
    colorIndex: index,
  })),
  tracks: sourceTracks,
  clips: spans,
  selections,
  ...layerClips,
  effects,
  timeline: {
    bpm: BPM,
    fps: FPS,
    canvasWidth: WIDTH,
    canvasHeight: HEIGHT,
    displaySeconds: false,
    snapToBeat: true,
    projectDuration: frames(LENGTH),
  },
  playPosition: 0,
  playStartPosition: 0,
  orderDefaulted: true,
  clipContentEffects: true,
  // Its stacks open as written: each MIDI clip has its own Gain and
  // instrument.
  audioGainDefaulted: true,
  midiClipEffects: true,
};

// ---- manifest ------------------------------------------------------------

function asset(source, mediaType, credit) {
  const bytes = readFileSync(resolve(MEDIA_DIR, source.file));
  return {
    id: `zvid-sample:${SAMPLE_VERSION}:${source.key}`,
    path: samplePath(source.file),
    url: `/samples/${SAMPLE_VERSION}/${source.file}`,
    name: source.file,
    mediaType,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    credit,
  };
}

const manifest = {
  id: "zvid-midi",
  version: SAMPLE_VERSION,
  sessionName: "zvid MIDI sample",
  creditsUrl: `/samples/${SAMPLE_VERSION}/CREDITS.md`,
  assets: [
    asset(FOREST, "application/zip", LOTTIE_CREDIT("Forest Morning")),
    asset(DOTS, "application/zip", LOTTIE_CREDIT("Gradient Dots Background")),
    asset(ICON, "image/svg+xml", ICON_CREDIT),
  ],
};

const sessionText = `${JSON.stringify(session, null, 2)}\n`;
const manifestText = `// Generated by scripts/sample/build-midi-sample.mjs; do not edit.
import type { SampleManifest } from "./sample-manifest.ts";

export const MIDI_SAMPLE_MANIFEST: SampleManifest = ${JSON.stringify(manifest, null, 2)};
`;

if (process.argv.includes("--check")) {
  const stale = [
    [SESSION_FILE, sessionText],
    [MANIFEST_FILE, manifestText],
  ].filter(([file, expected]) => {
    try {
      return readFileSync(file, "utf8") !== expected;
    } catch {
      return true;
    }
  });
  if (stale.length) {
    console.error(
      `Out of date: ${stale.map(([file]) => file).join(", ")}. Run node app/scripts/sample/build-midi-sample.mjs.`,
    );
    process.exit(1);
  }
} else {
  writeFileSync(SESSION_FILE, sessionText);
  writeFileSync(MANIFEST_FILE, manifestText);
  console.log(`Wrote ${SESSION_FILE} and ${MANIFEST_FILE}`);
}
