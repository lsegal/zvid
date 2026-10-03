// Writes the zvid opening sample: the editable session template
// `src/sample/zvid-opening.lvp` and its asset manifest
// `src/sample/opening-manifest.generated.ts`, hashed from the media in
// `public/samples/opening-v1`.
//
//   node app/scripts/sample/build-opening-sample.mjs [--check]
//
// `--check` fails when either file doesn't match what would be written.
//
// Everything the sample shows is native zvid editing: the three sources are
// clean clips on their own layers, cut every 1.5 s, and the arrangements,
// effects, animation and titles are layers, FX clips and effects in the
// session. Times are in seconds at 30 fps; the music is 80 BPM, so a 1.5 s
// cut is two beats.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE_VERSION = "opening-v1";
const MEDIA_DIR = resolve(APP, "public/samples", SAMPLE_VERSION);
const SESSION_FILE = resolve(APP, "src/sample/zvid-opening.lvp");
const MANIFEST_FILE = resolve(APP, "src/sample/opening-manifest.generated.ts");

const FPS = 30;
const BPM = 80;
const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION_SECONDS = 30;
// Source clips are 16 s long.
const SOURCE_FRAMES = 16 * FPS;

const IVORY = "rgba(243,226,191,1)";
const INK = "rgba(12,40,56,1)";
const LIGHT = "rgba(236,242,240,1)";

// A path no disk or server resolves: the app maps it to the manifest's
// asset, so the sample never asks to locate its media.
const samplePath = (name) => `zvid-sample://${SAMPLE_VERSION}/${name}`;

const MUSIC_CREDIT =
  '"Decisions" by Kevin MacLeod (incompetech.com), licensed under CC BY 4.0 ' +
  "(https://creativecommons.org/licenses/by/4.0/). First 30 seconds " +
  "excerpted with a 0.6 s fade-in and 2 s fade-out, synchronized to the " +
  "sample's graphics.";
const VIDEO_CREDIT =
  "Original procedural motion made for zvid (app/scripts/sample/render_sources.py).";

const SOURCES = [
  { key: "orbit", name: "Orbit", file: "orbit.mp4" },
  { key: "ribbon", name: "Ribbon", file: "ribbon.mp4" },
  { key: "corridor", name: "Corridor", file: "corridor.mp4" },
];
const MUSIC = { key: "music", name: "Decisions", file: "decisions-30s.m4a" };

// Layers, top first. The titles sit above the FX and Order layers, so no
// effect or arrangement touches them.
const LAYERS = [
  { id: "title-wordmark", name: "Title · zvid" },
  { id: "title-words", name: "Title · words" },
  { id: "fx-regions", name: "FX regions (Transform + Move)" },
  { id: "order", name: "Order three-ups" },
  { id: "orbit", name: "Orbit" },
  { id: "ribbon", name: "Ribbon" },
  { id: "corridor", name: "Corridor" },
  { id: "background", name: "Background" },
];
const VIDEO_LAYERS = ["orbit", "ribbon", "corridor"];

const frames = (seconds) => Math.round(seconds * FPS);

// ---- effects -------------------------------------------------------------

const effects = [];
let effectCount = 0;

function param(value) {
  return typeof value === "number"
    ? { floatValue: value }
    : { stringValue: value };
}

function addEffect(trackId, effectName, parameters, extra = {}) {
  effectCount += 1;
  effects.push({
    id: `sample-fx-${String(effectCount).padStart(3, "0")}`,
    trackId,
    effectName,
    parameters: Object.fromEntries(
      Object.entries(parameters).map(([key, value]) => [key, param(value)]),
    ),
    ...extra,
  });
}

const clipTrack = (clipId) => `clip:${clipId}`;
const zoomUnit = (zoom) => Math.round((zoom - 1) * 100) / 300;

function animation(mode, clip, reactive) {
  return {
    enabled: true,
    mode,
    clip: {
      motionIn: "Ease Out",
      motionOut: "Ease In",
      timing: "Normal",
      ...clip,
    },
    reactive: {
      motion: "Wobble",
      timing: "Normal",
      reactivity: 0.5,
      parameters: [],
      ...reactive,
    },
  };
}

function zoomAndPan(trackId, from, to) {
  addEffect(trackId, "ZoomAndPan", {
    _Start_Zoom: zoomUnit(from.zoom),
    _Start_X: from.x ?? 0.5,
    _Start_Y: from.y ?? 0.5,
    _End_Zoom: zoomUnit(to.zoom),
    _End_X: to.x ?? 0.5,
    _End_Y: to.y ?? 0.5,
  });
}

function transformValues(prefix, values) {
  return {
    [`${prefix}PositionX`]: values.x ?? 0,
    [`${prefix}PositionY`]: values.y ?? 0,
    [`${prefix}ScaleX`]: values.scaleX ?? 1,
    [`${prefix}ScaleY`]: values.scaleY ?? 1,
    [`${prefix}OriginX`]: 0,
    [`${prefix}OriginY`]: 0,
    [`${prefix}Rotation`]: values.rotation ?? 0,
  };
}

function move(trackId, motion, from, to) {
  addEffect(trackId, "Move", {
    Motion: motion,
    ...transformValues("Start", from),
    ...transformValues("End", to),
  });
}

// ---- layer defaults ------------------------------------------------------

// Every layer gets a Layout. In the Vertical rows a source is cropped to a
// wide band, and Layout picks the part it keeps: the corridor's rising line
// sits low in the frame.
for (const layer of LAYERS) {
  addEffect(layer.id, "Layout", {
    Position: layer.id === "corridor" ? "Bottom" : "Center",
  });
}

// ---- source spans and cuts -----------------------------------------------

const sourceTracks = SOURCES.map((source, index) => ({
  id: `source-${source.key}`,
  name: `${source.name} source`,
  colorIndex: index,
  recordings: [{ filename: samplePath(source.file) }],
}));
const spans = [];
const selections = [];

// Places `source` on `layerId` from `start` for `duration` seconds, playing
// the source from `inSeconds`. Returns the arrangement clip's id.
function cut(layerId, sourceIndex, start, duration, inSeconds, label) {
  const source = SOURCES[sourceIndex];
  const index = selections.length + 1;
  const inFrame = frames(inSeconds);
  if (inFrame + frames(duration) > SOURCE_FRAMES) {
    throw new Error(`Cut ${index} runs past the end of ${source.file}`);
  }
  const spanId = `span-${String(index).padStart(2, "0")}`;
  spans.push({
    id: spanId,
    trackId: `source-${source.key}`,
    name: `${source.name} · ${label}`,
    frameStart: frames(start),
    frameCount: frames(duration),
    clipStart: inFrame,
    frameOffset: 0,
    filePath: samplePath(source.file),
  });
  selections.push({
    id: index,
    trackId: `source-${source.key}`,
    mainTrackId: layerId,
    frameStart: frames(start),
    frameEnd: frames(start + duration),
  });
  return `selection-${index}`;
}

// Opening shots, each a single full-frame source.
zoomAndPan(
  clipTrack(cut("corridor", 2, 0, 1.5, 0.5, "opening push")),
  { zoom: 1 },
  { zoom: 1.3 },
);
const captureShot = clipTrack(cut("orbit", 0, 1.5, 1.5, 2, "capture"));
zoomAndPan(captureShot, { zoom: 1.25, x: 0.45 }, { zoom: 1.05, x: 0.55 });

// The three-ups: every 1.5 s each video layer cuts to a new source, in-point
// and crop, and the sources rotate between the panels. Odd cuts crop tight.
const THREE_UPS = [
  3, 4.5, 6, 7.5, 9, 10.5, 15, 16.5, 18, 19.5, 21, 22.5, 24, 25.5,
];
const REACTIVE_COLOR = (start) =>
  (start >= 9 && start < 12) || (start >= 21 && start < 24);
THREE_UPS.forEach((start, cutIndex) => {
  VIDEO_LAYERS.forEach((layerId, panel) => {
    const sourceIndex = (panel + cutIndex) % SOURCES.length;
    const inSeconds = 0.4 + ((cutIndex * 7 + panel * 5) % 11) * 1.2;
    const tight = cutIndex % 2 === 1;
    const clipId = cut(
      layerId,
      sourceIndex,
      start,
      1.5,
      inSeconds,
      `${start.toFixed(1)} s · ${tight ? "tight crop" : "wide"}`,
    );
    const drift = (panel - 1) * 0.08;
    zoomAndPan(
      clipTrack(clipId),
      tight
        ? { zoom: 1.7, x: 0.5 + drift, y: 0.42 }
        : { zoom: 1, x: 0.5, y: 0.5 },
      tight
        ? { zoom: 1.85, x: 0.5 - drift, y: 0.58 }
        : { zoom: 1.2, x: 0.5 + drift, y: 0.5 },
    );
    if (REACTIVE_COLOR(start)) {
      // Reactive animation swings the hue with the music's hits.
      addEffect(
        clipTrack(clipId),
        "Colorize",
        { _HueOffset: 0.12 + ((cutIndex + panel) % 3) * 0.28 },
        {
          animation: animation(
            "reactive",
            {},
            { motion: "Wobble", reactivity: 1, parameters: ["_HueOffset"] },
          ),
        },
      );
    }
  });
});

// Full-frame ribbon under the Pixelate window.
zoomAndPan(
  clipTrack(cut("ribbon", 1, 12, 3, 3, "edit")),
  { zoom: 1.05, x: 0.42 },
  { zoom: 1.25, x: 0.58 },
);

// ---- layer clips: Order, FX regions, titles, background ------------------

const layerClips = { fills: [], texts: [], fxClips: [] };

function layerClip(kind, id, layerId, start, duration) {
  layerClips[kind].push({
    id,
    mainTrackId: layerId,
    frameStart: frames(start),
    frameEnd: frames(start + duration),
  });
  return id;
}

// Order three-ups. Each FX clip arranges the layers beneath it; Clip-mode
// animation with Full timing eases the ivory spacing, and the outer margin
// framing the arrangement with it, open to its setting at the middle of the
// clip and closed again by its end.
const ARRANGEMENTS = [
  [3, 3, "Horizontal"],
  [6, 3, "Vertical"],
  [9, 3, "Horizontal"],
  [15, 3, "Horizontal"],
  [18, 3, "Vertical"],
  [21, 1.5, "Horizontal"],
  [22.5, 1.5, "Vertical"],
  [24, 1.5, "Horizontal"],
  [25.5, 1.5, "Vertical"],
];
for (const [start, duration, arrangement] of ARRANGEMENTS) {
  const id = layerClip(
    "fxClips",
    `order-${start.toFixed(1).replace(".", "-")}`,
    "order",
    start,
    duration,
  );
  addEffect(
    clipTrack(id),
    "Order",
    {
      Arrangement: arrangement,
      // The titles are above the Order already; the background is left out
      // so it would fill the frame behind the arrangement.
      ExcludedLayers: "background",
      GridSize: 2,
      Spacing: 108,
      Margin: 108,
      BorderColor: IVORY,
    },
    {
      animation: animation(
        "clip",
        { motionIn: "Ease In Out", motionOut: "Ease In Out", timing: "Full" },
        { motion: "Bounce", reactivity: 0.3, parameters: ["Spacing"] },
      ),
    },
  );
}

// Localized FX: each FX clip's Transform sizes its box (30% × 56% of the
// canvas) and a Move before it sweeps the box left to right, widening it
// and turning it from -16° to +16° over the clip.
const REGIONS = [
  [12, "Pixelate", { _NumPixels: 0.75 }],
  [15, "NegativeSplit", { _LowIntensity: 1, _HighIntensity: 1 }],
  [18, "AnalogGlitch", { _LowMod: 0.85, _HighMod: 1 }],
];
for (const [start, effectName, parameters] of REGIONS) {
  const id = layerClip(
    "fxClips",
    `region-${effectName.toLowerCase()}`,
    "fx-regions",
    start,
    3,
  );
  addEffect(clipTrack(id), effectName, parameters);
  move(
    clipTrack(id),
    "Ease In Out",
    { x: -0.22, y: 0.03, scaleX: 0.93, rotation: -16 },
    { x: 0.22, y: -0.03, scaleX: 1.3, rotation: 16 },
  );
  addEffect(clipTrack(id), "Transform", {
    ...transformValues("", { scaleX: 0.3, scaleY: 0.56 }),
  });
}

function text(id, layerId, start, duration, style, extra = {}) {
  layerClip("texts", id, layerId, start, duration);
  addEffect(
    clipTrack(id),
    "Text",
    {
      FontFamily: "Inter",
      FontWeight: "Regular",
      FontStyle: "",
      Align: "Center",
      VerticalAlign: "Middle",
      ResizeToFit: "Off",
      FillMode: "Solid",
      Color: LIGHT,
      Stroke: "rgba(0,0,0,0)",
      Shadow: "Off",
      LineHeight: 1.1,
      LetterSpacing: 0,
      StrokeWidth: 0,
      Padding: 0,
      ...style,
    },
    extra,
  );
  return clipTrack(id);
}

const fadeIn = (timing = "Fast") =>
  animation("clip", { motionIn: "Ease Out", motionOut: "None", timing });

// 0–1.5 s: the brand hit over the corridor.
addEffect(
  text("text-open-zvid", "title-wordmark", 0, 1.5, {
    Text: "zvid",
    FontWeight: "Bold",
    FontSize: 256,
    LetterSpacing: -0.02,
  }),
  "Transform",
  transformValues("", { y: -0.02 }),
);
addEffect(
  text(
    "text-open-tagline",
    "title-words",
    0,
    1.5,
    { Text: "capture, edit, repeat", FontSize: 50 },
    { animation: fadeIn() },
  ),
  "Transform",
  transformValues("", { y: 0.2 }),
);

// 1.5–3 s: "capture" rises into place over the orbit.
move(
  text(
    "text-capture",
    "title-words",
    1.5,
    1.5,
    { Text: "capture", FontWeight: "Bold", FontSize: 64 },
    { animation: fadeIn() },
  ),
  "Ease Out",
  { y: 0.37 },
  { y: 0.31 },
);

// 12–15 s: "edit" in the lower left, clean beside the Pixelate window.
addEffect(
  text(
    "text-edit",
    "title-words",
    12,
    3,
    {
      Text: "edit",
      FontWeight: "Bold",
      FontSize: 96,
      Align: "Left",
      Padding: 140,
    },
    { animation: fadeIn() },
  ),
  "Transform",
  transformValues("", { y: 0.35 }),
);

// 24–27 s: the wordmark returns above the alternating three-ups.
text(
  "text-montage-zvid",
  "title-wordmark",
  24,
  3,
  {
    Text: "zvid",
    FontWeight: "Bold",
    FontSize: 256,
    LetterSpacing: -0.02,
    Shadow: "On",
    ShadowColor: "rgba(12,40,56,0.55)",
    ShadowBlur: 24,
    ShadowOffsetX: 0,
    ShadowOffsetY: 6,
  },
  { animation: fadeIn("Normal") },
);

// 27–30 s: the ivory title card.
const card = layerClip("fills", "fill-title-card", "background", 27, 3);
addEffect(clipTrack(card), "Color", {
  Mode: "Solid",
  Color: IVORY,
  Opacity: 1,
});
// Pool light drifts over the card.
addEffect(clipTrack(card), "Caustics", {
  _Intensity: 0.25,
  _Scale: 0.6,
  _Speed: 0.25,
  _Warp: 0,
  _Color: "rgba(170,240,255,1)",
  _Blend: "Multiply",
});
addEffect(
  text(
    "text-card-zvid",
    "title-wordmark",
    27,
    3,
    {
      Text: "zvid",
      FontWeight: "Bold",
      FontSize: 320,
      LetterSpacing: -0.02,
      Color: INK,
    },
    { animation: fadeIn("Slow") },
  ),
  "Transform",
  transformValues("", { y: -0.04 }),
);
addEffect(
  text(
    "text-card-tagline",
    "title-words",
    27,
    3,
    { Text: "capture, edit, repeat", FontSize: 56, Color: INK },
    { animation: fadeIn("Slow") },
  ),
  "Transform",
  transformValues("", { y: 0.18 }),
);

// ---- music ---------------------------------------------------------------

// The music is a source track of its own: one clip of the whole file from
// time 0, sounding through a Gain at 0 dB. The layers hold only the silent
// video sources, fills, text and FX, so the mix plays it from the source
// tracks.
const MUSIC_TRACK = `source-${MUSIC.key}`;
const MUSIC_SPAN = `span-${MUSIC.key}`;
sourceTracks.push({
  id: MUSIC_TRACK,
  name: "Music",
  colorIndex: sourceTracks.length,
  recordings: [{ filename: samplePath(MUSIC.file) }],
});
spans.push({
  id: MUSIC_SPAN,
  trackId: MUSIC_TRACK,
  name: "Music",
  frameStart: 0,
  frameCount: frames(DURATION_SECONDS),
  clipStart: 0,
  frameOffset: 0,
  filePath: samplePath(MUSIC.file),
});
// A session clip loads as source clip `source-<id>`, whose stack this is.
addEffect(`source-clip:source-${MUSIC_SPAN}`, "Gain", { Gain: 0, Mute: 0 });

// ---- added effects -------------------------------------------------------

// Effects added after the sample was first laid out, last so the ids of
// the effects above stay put.

// 1.5–3 s: the music's hits break the orbit under "capture" into blocky
// digital glitches.
addEffect(
  captureShot,
  "DigitalGlitch",
  {
    _Amount: 0.25,
    _BlockSize: 0.35,
    _Displace: 0.4,
    _ChannelShift: 0.5,
    _ColorCrush: 0,
    _Rate: 12,
  },
  {
    animation: animation(
      "reactive",
      {},
      { motion: "Bounce", reactivity: 0.6, parameters: ["_Amount"] },
    ),
  },
);

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
    displaySeconds: true,
    snapToBeat: true,
    projectDuration: DURATION_SECONDS * FPS,
  },
  playPosition: 0,
  playStartPosition: 0,
  orderDefaulted: true,
  clipContentEffects: true,
  // Its stacks open as written: only the music's clip has a Gain.
  audioGainDefaulted: true,
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
  id: "zvid-opening",
  version: SAMPLE_VERSION,
  sessionName: "zvid opening sample",
  creditsUrl: `/samples/${SAMPLE_VERSION}/CREDITS.md`,
  assets: [
    ...SOURCES.map((source) => asset(source, "video/mp4", VIDEO_CREDIT)),
    asset(MUSIC, "audio/mp4", MUSIC_CREDIT),
  ],
};

const sessionText = `${JSON.stringify(session, null, 2)}\n`;
const manifestText = `// Generated by scripts/sample/build-opening-sample.mjs; do not edit.
import type { SampleManifest } from "./sample-manifest.ts";

export const OPENING_SAMPLE_MANIFEST: SampleManifest = ${JSON.stringify(manifest, null, 2)};
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
      `Out of date: ${stale.map(([file]) => file).join(", ")}. Run node app/scripts/sample/build-opening-sample.mjs.`,
    );
    process.exit(1);
  }
} else {
  writeFileSync(SESSION_FILE, sessionText);
  writeFileSync(MANIFEST_FILE, manifestText);
  console.log(`Wrote ${SESSION_FILE} and ${MANIFEST_FILE}`);
}
