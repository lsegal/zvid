// Writes the zvid opening sample: the editable session template
// `src/sample/zvid-opening.project.json` and its asset manifest
// `src/sample/opening-manifest.generated.ts`, hashed from the media in
// `public/samples/opening-v2`.
//
//   node app/scripts/sample/build-opening-sample.mjs [--check]
//
// `--check` fails when either file doesn't match what would be written.
//
// Everything the sample shows is native zvid editing: the three sources are
// clean clips on their own layers, cut every 1.5 s from one clip per source
// track, and the arrangements, effects, animation and titles are layers, FX
// clips and effects in the session. Times are in seconds at 30 fps; the music is 80 BPM, so a 1.5 s
// cut is two beats.
//
// It is also a tour of the effects: every video effect sits on a clip of
// its own, and the music plays from the Audio layer as two-beat selections,
// each through a different audio effect.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SAMPLE_VERSION = "opening-v2";
const MEDIA_DIR = resolve(APP, "public/samples", SAMPLE_VERSION);
const SESSION_FILE = resolve(APP, "src/sample/zvid-opening.project.json");
const MANIFEST_FILE = resolve(APP, "src/sample/opening-manifest.generated.ts");

const FPS = 30;
const BPM = 80;
const WIDTH = 1920;
const HEIGHT = 1080;
const DURATION_SECONDS = 30;

const IVORY = "rgba(243,226,191,1)";
const INK = "rgba(12,40,56,1)";
const LIGHT = "rgba(236,242,240,1)";

// A path no disk or server resolves: the app maps it to the manifest's
// asset, so the sample never asks to locate its media.
const samplePath = (name) => `zvid-sample://${SAMPLE_VERSION}/${name}`;

const MUSIC_CREDIT =
  '"Just Nasty" by Kevin MacLeod (incompetech.com), licensed under CC BY 4.0 ' +
  "(https://creativecommons.org/licenses/by/4.0/). 2:00–2:30 excerpted " +
  "with a 0.6 s fade-in and 2 s fade-out, synchronized to the sample's " +
  "graphics.";
const VIDEO_CREDIT =
  "Original procedural motion made for zvid (app/scripts/sample/render_sources.py).";
const ICON_CREDIT = "The zvid logo, zvid's own artwork.";

const SOURCES = [
  { key: "orbit", name: "Orbit", file: "orbit.mp4" },
  { key: "ribbon", name: "Ribbon", file: "ribbon.mp4" },
  { key: "corridor", name: "Corridor", file: "corridor.mp4" },
];
const MUSIC = {
  key: "music",
  name: "Just Nasty",
  file: "just-nasty-30s.m4a",
};
const ICON = { key: "zvid-logo", file: "zvid-logo.svg" };

// Layers, top first. The Transitions layer is layer 1, so each transition
// renders above every other layer, titles and FX regions included. The
// titles sit above the other FX and Order layers, so no other effect or
// arrangement touches them. The hidden icon layer is never drawn itself: it
// is the Mask Target that cuts the 1.5 s shot to the zvid logo. The Audio layer
// holds only the music.
const LAYERS = [
  { id: "transitions", name: "Transitions" },
  { id: "title-wordmark", name: "Title · zvid" },
  { id: "title-words", name: "Title · words" },
  { id: "fx-regions", name: "FX regions (Transform + Move)" },
  { id: "icon-mask", name: "Mask · zvid logo", hidden: true },
  { id: "order", name: "Order three-ups" },
  { id: "orbit", name: "Orbit" },
  { id: "ribbon", name: "Ribbon" },
  { id: "corridor", name: "Corridor" },
  { id: "background", name: "Background" },
  { id: "audio", name: "Audio" },
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

// `lfo`, when given, adds LFO settings over the effect defaults' free-running
// Sine.
function animation(mode, clip, reactive, lfo) {
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
    ...(lfo
      ? {
          lfo: {
            shape: "Sine",
            sync: true,
            rate: 1,
            syncRate: "1 Bar",
            depth: 0.5,
            phase: 0,
            parameters: [],
            ...lfo,
          },
        }
      : {}),
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
// Each source track holds one clip: the source from frame 0, looping its
// 16 s of media across the whole project.
const sourceSpanId = (key) => `span-${key}`;
const spans = SOURCES.map((source) => ({
  id: sourceSpanId(source.key),
  trackId: `source-${source.key}`,
  name: source.name,
  frameStart: 0,
  frameCount: frames(DURATION_SECONDS),
  clipStart: 0,
  frameOffset: 0,
  filePath: samplePath(source.file),
}));
const selections = [];

// Places `source` on `layerId` from `start` for `duration` seconds, playing
// the source from `inSeconds`: the selection slips its source track's clip
// to that in-point, which may fall in the clip's looped media. `trim`
// optionally moves the clip's start or end frame without slipping its
// source, so the visible content stays where it was on the timeline. Returns
// the arrangement clip's id.
function cut(layerId, sourceIndex, start, duration, inSeconds, trim = {}) {
  const source = SOURCES[sourceIndex];
  const index = selections.length + 1;
  const inFrame = frames(inSeconds);
  selections.push({
    id: index,
    trackId: `source-${source.key}`,
    mainTrackId: layerId,
    frameStart: trim.frameStart ?? frames(start),
    frameEnd: trim.frameEnd ?? frames(start + duration),
    sourceClipId: sourceSpanId(source.key),
    sourceOffsetSeconds: (inFrame - frames(start)) / FPS,
  });
  return `selection-${index}`;
}

// Opening shots, each a single full-frame source.
const openingShot = clipTrack(cut("corridor", 2, 0, 1.5, 0.5));
zoomAndPan(openingShot, { zoom: 1 }, { zoom: 1.3 });
// The opening push is seen through rippling water, easing in and out with
// the clip.
addEffect(
  openingShot,
  "Refraction",
  {
    _Type: "Water",
    _Amount: 0.45,
    _Scale: 0.4,
    _Speed: 0.5,
    _Angle: 90,
    _Dispersion: 0.2,
  },
  { animation: animation("clip", {}, { parameters: ["_Amount"] }) },
);
const captureShot = clipTrack(cut("orbit", 0, 1.5, 1.5, 2));
zoomAndPan(captureShot, { zoom: 1.25, x: 0.45 }, { zoom: 1.05, x: 0.55 });
// The music's hits break the orbit under "capture" into blocky digital
// glitches, while the music is bitcrushed beneath them.
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
// The orbit opens out of the zvid logo on the hidden layer.
addEffect(captureShot, "Mask", { Target: "icon-mask", Mode: "Additive" });

// The three-ups: every 1.5 s each video layer cuts to a new source, in-point
// and crop, and the sources rotate between the panels. Odd cuts crop tight.
const THREE_UPS = [
  3, 4.5, 6, 7.5, 9, 10.5, 15, 16.5, 18, 19.5, 21, 22.5, 24, 25.5,
];
const REACTIVE_COLOR = (start) =>
  (start >= 9 && start < 12) || (start >= 21 && start < 24);
// One panel of a three-up shows off a Distortion or Refraction type, each
// easing in and back out with its clip. Keyed by layer and start; the
// reactive Colorize passages are left to Colorize.
const distortion = (type, parameters) => [
  "Distortion",
  {
    _Type: type,
    _Edges: "Mirror",
    _Amount: 0.5,
    _Size: 0.6,
    _Speed: 0,
    _Angle: 0,
    _CenterX: 0.5,
    _CenterY: 0.5,
    ...parameters,
  },
];
const refraction = (type, parameters) => [
  "Refraction",
  {
    _Type: type,
    _Amount: 0.5,
    _Scale: 0.5,
    _Speed: 0.2,
    _Angle: 90,
    _Dispersion: 0.3,
    ...parameters,
  },
];
const PANEL_EFFECTS = new Map([
  // A focus pull: the panel blurs in and out of focus over its cut.
  ["corridor 3", ["GaussianBlur", { _Radius: 24 }]],
  ["orbit 3", distortion("Wave", { _Amount: 0.4, _Size: 0.5, _Speed: 0.5 })],
  ["ribbon 4.5", distortion("Twirl", { _Amount: 0.6 })],
  ["corridor 6", distortion("Bulge", { _Amount: 0.7, _Size: 0.7 })],
  ["orbit 7.5", distortion("Ripple", { _Amount: 0.4, _Speed: 0.6 })],
  ["ribbon 16.5", distortion("Fisheye", { _Amount: 0.8, _Size: 1 })],
  ["corridor 16.5", refraction("Frosted Glass", { _Amount: 0.6 })],
  ["orbit 19.5", refraction("Reeded Glass", { _Scale: 0.35 })],
  ["ribbon 24", refraction("Glass Blocks", { _Scale: 0.4 })],
  [
    "corridor 25.5",
    distortion("Turbulence", { _Amount: 0.4, _Size: 0.4, _Speed: 0.6 }),
  ],
]);
// A panel cut to a Shape, its slot's border color showing around it.
const PANEL_SHAPES = new Map([["ribbon 15", "Oval"]]);
// Panels trimmed so they enter or leave while an Order is running, showing
// off its enter and leave Push. Frames at 30 fps, keyed by layer and start.
// A layer shows one clip at a time, so no trim runs past the next cut.
const PANEL_TRIMS = new Map([
  ["ribbon 3", { frameStart: 101 }],
  ["corridor 3", { frameStart: 113 }],
  ["ribbon 4.5", { frameEnd: 169 }],
  ["ribbon 6", { frameStart: 191 }],
]);
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
      PANEL_TRIMS.get(`${layerId} ${start}`),
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
    const panelShape = PANEL_SHAPES.get(`${layerId} ${start}`);
    if (panelShape) {
      addEffect(clipTrack(clipId), "Shape", { Shape: panelShape });
    }
    const panelEffect = PANEL_EFFECTS.get(`${layerId} ${start}`);
    if (panelEffect) {
      const [effectName, parameters] = panelEffect;
      addEffect(clipTrack(clipId), effectName, parameters, {
        animation: animation("clip"),
      });
    }
  });
});

// Full-frame ribbon under the Pixelate window.
const ribbonShot = clipTrack(cut("ribbon", 1, 12, 3, 3));
zoomAndPan(ribbonShot, { zoom: 1.05, x: 0.42 }, { zoom: 1.25, x: 0.58 });

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

// Order three-ups. Each FX clip arranges the layers beneath it with its own
// ivory spacing and outer margin; Clip-mode animation with the Push
// transition slides each clip into the arrangement from its slot's side as
// it enters and back out as it leaves.
const ARRANGEMENTS = [
  [3, 3, "Horizontal", 108, 108],
  [6, 3, "Vertical", 108, 108],
  [9, 3, "Horizontal", 108, 108],
  [15, 3, "Horizontal", 108, 108],
  [18, 3, "Vertical", 48, 12],
  [21, 1.5, "Horizontal", 64, 0],
  [22.5, 1.5, "Vertical", 50, 57],
  [24, 1.5, "Horizontal", 0, 108],
  [25.5, 1.5, "Vertical", 0, 108],
];
for (const [start, duration, arrangement, spacing, margin] of ARRANGEMENTS) {
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
      // so it would fill the frame behind the arrangement, and the Audio
      // layer so its music takes no panel.
      ExcludedLayers: "background,audio",
      GridSize: 2,
      Spacing: spacing,
      Margin: margin,
      BorderColor: IVORY,
    },
    {
      // An Order eases the clips entering and leaving beneath it itself, so
      // it has no Motion In or Out.
      animation: {
        enabled: true,
        mode: "clip",
        clip: { timing: "Normal", transition: "Push" },
      },
    },
  );
}

// A Transition across the cut at bar 5 (12 s) glitches the last Horizontal
// three-up into the full-frame shot after it, as one picture.
const transition = layerClip(
  "fxClips",
  "transition-12-0",
  "transitions",
  11.5,
  1,
);
addEffect(
  clipTrack(transition),
  "Transition",
  { Type: "Glitch", Softness: 0 },
  {
    animation: {
      enabled: true,
      mode: "clip",
      clip: { motionIn: "Ease In", motionOut: "Ease Out", timing: "Full" },
    },
  },
);

// Transitions across the cuts at bar 6 (15 s) and bar 7 (18 s): the ribbon
// shot ripples into the next three-up, and that three-up dissolves into the
// Vertical one after it.
for (const [start, type] of [
  [15, "Ripple"],
  [18, "Dissolve"],
]) {
  const id = layerClip(
    "fxClips",
    `transition-${start.toFixed(1).replace(".", "-")}`,
    "transitions",
    start - 0.5,
    1,
  );
  addEffect(
    clipTrack(id),
    "Transition",
    { Type: type, Softness: 0 },
    {
      animation: {
        enabled: true,
        mode: "clip",
        clip: { motionIn: "Ease In", motionOut: "Ease Out", timing: "Full" },
      },
    },
  );
}

// The zvid logo the 1.5 s shot is masked by: a Custom Shape on the hidden
// layer. The shape stretches its viewBox over the box, so the box keeps the
// logo's 258 × 212 aspect on the 16:9 canvas. In one beat it pops open from
// a small logo until it nearly fills the frame's height, then holds there
// for the next beat on a second clip, as a Move spans its whole clip. The
// logo is centered in its viewBox, so the box stays centered too.
const ICON_ASPECT = 258 / 212;
const iconBox = (height) => ({
  scaleX: (height * ICON_ASPECT * HEIGHT) / WIDTH,
  scaleY: height,
});
const ICON_FULL = { x: 0, y: 0, ...iconBox(0.9) };
function iconClip(id, start) {
  layerClip("fills", id, "icon-mask", start, 0.75);
  addEffect(clipTrack(id), "Color", {
    Mode: "Solid",
    Color: LIGHT,
    Opacity: 1,
  });
  addEffect(clipTrack(id), "Shape", {
    Shape: `Custom:${samplePath(ICON.file)}`,
  });
  return id;
}
const logoReveal = clipTrack(iconClip("fill-logo-reveal", 1.5));
move(logoReveal, "Ease Out", iconBox(0.15), ICON_FULL);
// The logo glitches as it pops open, a 1 Hz LFO swelling its Amount.
addEffect(
  logoReveal,
  "DigitalGlitch",
  {
    _Amount: 0.04,
    _BlockSize: 0.1,
    _Displace: 0.15,
    _ChannelShift: 0.3,
    _ColorCrush: 0,
    _Rate: 8,
  },
  {
    animation: animation(
      "lfo",
      {},
      { motion: "Bounce", reactivity: 0.6, parameters: ["_Amount"] },
      { sync: false, rate: 1, depth: 0.6, phase: 0, parameters: ["_Amount"] },
    ),
  },
);
addEffect(
  clipTrack(iconClip("fill-logo-hold", 2.25)),
  "Transform",
  transformValues("", ICON_FULL),
);

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
const montageWordmark = text(
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
// Its letters bloom in an ivory glow.
addEffect(
  montageWordmark,
  "Bloom",
  { _Threshold: 0.6, _Intensity: 0.9, _Radius: 0.5, _Tint: IVORY },
  {
    animation: animation("clip", {
      motionIn: "Ease Out",
      motionOut: "Ease In",
    }),
  },
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
// The wordmark is knocked out of the card, so its letters fade in from the
// dark beneath it rather than over the ivory.
addEffect(clipTrack(card), "Mask", {
  Target: "title-wordmark",
  Mode: "Subtractive",
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

// The music is a source track of its own, and the Audio layer plays it as
// consecutive two-beat selections covering the whole 30 s. Each selection's
// clip sounds through a Gain at 0 dB and one audio effect, set to be heard
// without clipping, so the music runs on through a tour of every audio
// effect, the first two beats clean. With the music on a layer, the mix
// plays only the layer clips, so the source track itself stays silent.
// The source track holds the whole music as one clip, which each selection
// plays where it is in the file.
const MUSIC_TRACK = `source-${MUSIC.key}`;
sourceTracks.push({
  id: MUSIC_TRACK,
  name: "Music",
  colorIndex: sourceTracks.length,
  recordings: [{ filename: samplePath(MUSIC.file) }],
});
const MUSIC_SECTIONS = [
  // 0–1.5 s: the opening push, clean.
  ["Clean"],
  // 1.5–3 s: crushed under the digital glitches.
  ["Bitcrush", { Bits: 5, Downsample: 8, Mix: 1 }],
  // 3–9 s: the Distortion three-ups.
  [
    "Phaser",
    { Rate: 2, Depth: 90, Stages: "8", Center: 1000, Feedback: 60, Mix: 50 },
  ],
  [
    "Chorus",
    { Rate: 1.5, Depth: 0.8, Delay: 20, Feedback: 0.3, Spread: 1, Mix: 0.6 },
  ],
  ["Auto Pan", { Sync: "On", Note: "1/4", Depth: 1, Shape: "Sine" }],
  ["Tremolo", { Sync: "On", Note: "1/16", Depth: 0.8, Shape: "Square" }],
  // 9–12 s: the reactive Colorize, which the sharpened hits drive harder.
  ["Transient Shaper", { Attack: 1, Sustain: -0.6, Output: -3 }],
  [
    "Compressor",
    {
      Threshold: -30,
      Ratio: 8,
      Attack: 1,
      Release: 80,
      Knee: 3,
      Makeup: 12,
      Mix: 1,
    },
  ],
  // 12–15 s: "edit" and the Pixelate window.
  ["High Cut", { Frequency: 600, Resonance: 0.7, Slope: "24 dB/oct" }],
  ["Low Cut", { Frequency: 1000, Resonance: 0.7, Slope: "24 dB/oct" }],
  // 15–21 s: Negative Split, Analog Glitch and the glass three-ups.
  [
    "EQ",
    {
      "Low Freq": 300,
      "Low Gain": -15,
      "Mid Freq": 1500,
      "Mid Gain": 3,
      "Mid Q": 1,
      "High Freq": 4000,
      "High Gain": -15,
    },
  ],
  ["Saturation", { Drive: 18, Type: "Tape", Tone: 8000, Output: -8, Mix: 1 }],
  ["Stereo", { Width: 200, Pan: 40 }],
  ["Mono", { Source: "Sum", Amount: 1 }],
  // 21–24 s: the reactive Colorize again, gated on its hits.
  [
    "Noise Gate",
    { Threshold: -20, Attack: 0.5, Hold: 10, Release: 40, Range: -80 },
  ],
  ["De-ess", { Frequency: 3000, Threshold: -45, Amount: 24, Listen: "Off" }],
  // 24–27 s: the wordmark returns.
  ["Reverse", {}],
  ["Limiter", { Ceiling: -4, Release: 50, Lookahead: 5, Gain: 9 }],
  // 27–30 s: echoes and a wash of reverb into the title card.
  [
    "Delay",
    {
      Sync: "On",
      Time: 375,
      Note: "1/8D",
      Feedback: 0.5,
      "Ping-pong": "On",
      "High cut": 6000,
      Mix: 0.45,
    },
  ],
  ["Reverb", { Decay: 6, "Pre-delay": 30, Size: 0.9, Damping: 6000, Mix: 0.5 }],
];
const MUSIC_SECTION_SECONDS = DURATION_SECONDS / MUSIC_SECTIONS.length;
spans.push({
  id: sourceSpanId(MUSIC.key),
  trackId: MUSIC_TRACK,
  name: "Music",
  frameStart: 0,
  frameCount: frames(DURATION_SECONDS),
  clipStart: 0,
  frameOffset: 0,
  filePath: samplePath(MUSIC.file),
});
MUSIC_SECTIONS.forEach(([name, parameters], index) => {
  const start = index * MUSIC_SECTION_SECONDS;
  const id = selections.length + 1;
  selections.push({
    id,
    trackId: MUSIC_TRACK,
    mainTrackId: "audio",
    frameStart: frames(start),
    frameEnd: frames(start + MUSIC_SECTION_SECONDS),
  });
  const clip = clipTrack(`selection-${id}`);
  addEffect(clip, "Gain", { Gain: 0, Mute: 0 });
  if (parameters) {
    addEffect(clip, name, parameters);
  }
});

// ---- session -------------------------------------------------------------

const session = {
  mainTracks: LAYERS.map((layer, index) => ({
    id: layer.id,
    name: layer.name,
    colorIndex: index,
    ...(layer.hidden ? { hidden: true } : {}),
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
  // Its stacks open as written: only the music's clips have a Gain.
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
    asset(ICON, "image/svg+xml", ICON_CREDIT),
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
