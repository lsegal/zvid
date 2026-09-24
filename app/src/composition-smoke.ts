// Pixel check for the compositor's multi-layer layout in a real WebGL
// context. Start the dev server (`pnpm dev`), open
// http://localhost:1420/composition-smoke.html and click "Run layout checks",
// or append `?autorun` to run on load. The first status line reads
// "PASSED n/n cases" or lists every failing band. Needs a browser with WebGL
// and a VP9 encoder to build the test sources.
import {
  BufferTarget,
  CanvasSource,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from "mediabunny";
import {
  CompositionRenderer,
  type CompositionRendererState,
} from "./CompositionPlayer";
import { type LayoutAnchor, resolveFrameBounds } from "./composition-layout.ts";

type MediaItem = CompositionRendererState["mediaItems"][number];
type SessionEffect = CompositionRendererState["effects"][number];
type Rgb = [number, number, number];
type Orientation = "portrait" | "landscape";
type EffectMode = "none" | "first-layer" | "all-layers" | "global" | "zoom";

// Each source is split into horizontal thirds so the sampled third shows
// which part of the source the Layout anchor put in the band. The primary
// channel names the layer; the secondary channel names the third.
const LAYER_COLORS: Array<[Rgb, Rgb, Rgb]> = [
  [
    [255, 0, 0],
    [255, 128, 0],
    [255, 255, 0],
  ],
  [
    [0, 255, 0],
    [0, 255, 128],
    [0, 255, 255],
  ],
  [
    [0, 0, 255],
    [128, 0, 255],
    [255, 0, 255],
  ],
];
const THIRDS = ["top", "middle", "bottom"] as const;
const CANVAS_WIDTH = 360;
const CANVAS_HEIGHT = 640;
const BPM = 120;
const TOLERANCE = 48;
// Zoom & Pan used by the "zoom" cases: 2.5x, pinned to the bottom edge.
const ZOOM = 0.5;
const ZOOM_SCALE = 1 / (1 + 3 * ZOOM);
const ZOOM_Y = 1;

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing smoke test element: ${selector}`);
  return element;
}

const statusElement = required<HTMLElement>("#status");
const runButton = required<HTMLButtonElement>("#run");

async function createSourceVideo(layer: number, orientation: Orientation) {
  const canvas = document.createElement("canvas");
  canvas.width = orientation === "portrait" ? 180 : 320;
  canvas.height = orientation === "portrait" ? 320 : 180;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  const third = canvas.height / 3;
  for (const [index, [r, g, b]] of LAYER_COLORS[layer].entries()) {
    context.fillStyle = `rgb(${r}, ${g}, ${b})`;
    context.fillRect(0, Math.round(index * third), canvas.width, third + 1);
  }

  const target = new BufferTarget();
  const output = new Output({ format: new WebMOutputFormat(), target });
  const source = new CanvasSource(canvas, {
    codec: "vp9",
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 0.5,
  });
  output.addVideoTrack(source, { frameRate: 10 });
  await output.start();
  for (let frame = 0; frame < 20; frame++) {
    await source.add(frame / 10, 1 / 10);
  }
  source.close();
  await output.finalize();
  if (!target.buffer) throw new Error("VP9 encoder returned no output.");
  return {
    url: URL.createObjectURL(new Blob([target.buffer], { type: "video/webm" })),
    width: canvas.width,
    height: canvas.height,
  };
}

function chainEffect(trackId: string): SessionEffect {
  // Colorize at zero hue offset is an identity pass, so colours survive the
  // chain and any change in the band comes from the compositor itself.
  return {
    id: `colorize-${trackId}`,
    trackId,
    effectName: "Colorize",
    parameters: [
      { key: "_HueOffset", value: "0", numericValue: 0 },
      { key: "_Reactivity", value: "0", numericValue: 0 },
    ],
  };
}

function zoomEffect(trackId: string): SessionEffect {
  const parameters = ["_Start", "_End"].flatMap((prefix) =>
    [
      ["Zoom", ZOOM],
      ["X", 0.5],
      ["Y", ZOOM_Y],
    ].map(([key, value]) => ({
      key: `${prefix}_${key}`,
      value: String(value),
      numericValue: value as number,
    })),
  );
  return {
    id: `zoom-${trackId}`,
    trackId,
    effectName: "ZoomAndPan",
    parameters,
  };
}

function buildState(
  sources: Array<{ url: string; width: number; height: number }>,
  anchor: LayoutAnchor,
  effectMode: EffectMode,
): CompositionRendererState {
  const lanes = sources.map((_, index) => ({
    id: `lane-${index}`,
    name: `Layer ${index + 1}`,
    colorIndex: index,
  }));
  const mediaItems = sources.map<MediaItem>((source, index) => ({
    id: `media-${index}`,
    name: `layer-${index}.webm`,
    kind: "video",
    durationSeconds: 2,
    width: source.width,
    height: source.height,
    hasAudio: false,
    hasVideo: true,
    previewUrl: source.url,
  }));
  const clips = sources.map((_, index) => ({
    id: `clip-${index}`,
    sourceTrackId: `lane-${index}`,
    laneId: `lane-${index}`,
    label: `Layer ${index + 1}`,
    mediaPath: `layer-${index}.webm`,
    mediaId: `media-${index}`,
    startQ: 0,
    durationSeconds: 2,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 2,
    tint: "#000",
    accent: "#fff",
  }));
  const effects: SessionEffect[] = [
    {
      id: "layout",
      trackId: "__group_main",
      effectName: "Layout",
      parameters: [{ key: "Position", value: anchor }],
    },
  ];
  // The first lane is drawn first (top band), so "first-layer" puts the chain
  // on the layer every other layer is drawn after.
  if (effectMode === "first-layer") {
    effects.push(chainEffect(lanes[0].id));
  } else if (effectMode === "all-layers") {
    effects.push(...lanes.map((lane) => chainEffect(lane.id)));
  } else if (effectMode === "global") {
    effects.push(chainEffect("__group_main"));
  } else if (effectMode === "zoom") {
    effects.push(...lanes.map((lane) => zoomEffect(lane.id)));
  }

  return {
    mediaItems,
    clips,
    lanes,
    effects,
    bpm: BPM,
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: CANVAS_HEIGHT,
  };
}

// Which third of the source shows at the centre of a band. The source covers
// its band, so a source relatively taller than the band shows only a slice,
// placed by the anchor. Layer effects work on that slice: Zoom & Pan picks
// its window inside what the band shows, not inside the whole source.
function expectedThird(
  anchor: LayoutAnchor,
  source: { width: number; height: number },
  layerCount: number,
  effectMode: EffectMode,
) {
  const bandAspect = (CANVAS_WIDTH / CANVAS_HEIGHT) * layerCount;
  const visible = Math.min(1, source.width / source.height / bandAspect);
  const start =
    anchor === "top"
      ? 0
      : anchor === "bottom"
        ? 1 - visible
        : (1 - visible) / 2;
  const withinBand =
    effectMode === "zoom" ? ZOOM_Y * (1 - ZOOM_SCALE) + ZOOM_SCALE / 2 : 0.5;
  return Math.min(2, Math.floor((start + visible * withinBand) * 3));
}

function readPixel(gl: WebGLRenderingContext, x: number, yFromTop: number) {
  const pixel = new Uint8Array(4);
  gl.readPixels(
    Math.round(x),
    CANVAS_HEIGHT - 1 - Math.round(yFromTop),
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixel,
  );
  return [pixel[0], pixel[1], pixel[2]] as Rgb;
}

// Black (nothing decoded yet) or the compositor's clear colour.
function isEmpty([r, g, b]: Rgb) {
  return r + g + b < 24 || (r < 30 && g < 30 && b < 40 && b > r);
}

function bandsHaveContent(gl: WebGLRenderingContext, count: number) {
  for (let band = 0; band < count; band++) {
    const y = ((band + 0.5) / count) * CANVAS_HEIGHT;
    if (isEmpty(readPixel(gl, CANVAS_WIDTH / 2, y))) return false;
  }
  return true;
}

function matches(actual: Rgb, expected: Rgb) {
  return actual.every(
    (value, index) => Math.abs(value - expected[index]) <= TOLERANCE,
  );
}

async function runCase(
  sources: Array<{ url: string; width: number; height: number }>,
  anchor: LayoutAnchor,
  effectMode: EffectMode,
) {
  const canvas = document.createElement("canvas");
  const renderer = new CompositionRenderer(
    buildState(sources, anchor, effectMode),
    { canvas, audioAnalysis: "offline" },
  );
  const failures: string[] = [];
  try {
    const gl = canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL is unavailable.");
    // A new video element may not have decoded its first frame yet, so render
    // until every band shows something other than the empty canvas.
    for (let attempt = 0; attempt < 20; attempt++) {
      await renderer.renderFrameAt(0.5, 0.25);
      if (bandsHaveContent(gl, sources.length)) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const third = expectedThird(anchor, sources[0], sources.length, effectMode);
    for (let band = 0; band < sources.length; band++) {
      // Band 0 is the top band and holds the first lane.
      const layer = band;
      const bounds = resolveFrameBounds(band, sources.length, 1);
      const top =
        ((1 - (bounds.centerY + bounds.halfHeight)) / 2) * CANVAS_HEIGHT;
      const bottom =
        ((1 - (bounds.centerY - bounds.halfHeight)) / 2) * CANVAS_HEIGHT;
      const center = readPixel(gl, CANVAS_WIDTH / 2, (top + bottom) / 2);
      if (!matches(center, LAYER_COLORS[layer][third])) {
        failures.push(
          `band ${band} center is rgb(${center.join(", ")}), expected layer ${layer + 1} ${THIRDS[third]} rgb(${LAYER_COLORS[layer][third].join(", ")})`,
        );
      }
      for (const [edge, y] of [
        ["top", top + 2],
        ["bottom", bottom - 3],
      ] as const) {
        const pixel = readPixel(gl, CANVAS_WIDTH / 2, y);
        const primary = LAYER_COLORS[layer][0];
        const isLayer = primary.every(
          (value, index) =>
            value === 0 || Math.abs(pixel[index] - value) <= TOLERANCE,
        );
        if (!isLayer) {
          failures.push(
            `band ${band} ${edge} edge is rgb(${pixel.join(", ")}), not layer ${layer + 1}`,
          );
        }
      }
    }
  } finally {
    renderer.destroy();
  }

  return failures;
}

async function run() {
  runButton.disabled = true;
  const lines: string[] = [];
  let failed = 0;
  let total = 0;
  try {
    for (const orientation of ["portrait", "landscape"] as const) {
      statusElement.textContent = `Encoding ${orientation} sources...`;
      const sources = await Promise.all(
        LAYER_COLORS.map((_, layer) => createSourceVideo(layer, orientation)),
      );
      for (let count = 1; count <= 3; count++) {
        for (const anchor of THIRDS.map((third) =>
          third === "middle" ? "center" : third,
        ) as LayoutAnchor[]) {
          for (const effectMode of [
            "none",
            "first-layer",
            "all-layers",
            "global",
            "zoom",
          ] as const) {
            total++;
            const name = `${count} layer(s), ${orientation}, ${anchor}, effects: ${effectMode}`;
            statusElement.textContent = `Rendering ${name}...`;
            const failures = await runCase(
              sources.slice(0, count),
              anchor,
              effectMode,
            );
            if (failures.length) {
              failed++;
              lines.push(
                `FAIL ${name}`,
                ...failures.map((line) => `  ${line}`),
              );
            } else {
              lines.push(`ok   ${name}`);
            }
          }
        }
      }
      for (const source of sources) URL.revokeObjectURL(source.url);
    }
    lines.unshift(
      failed
        ? `FAILED ${failed}/${total} cases`
        : `PASSED ${total}/${total} cases`,
    );
  } catch (error) {
    lines.unshift(`Error: ${error}`);
  } finally {
    statusElement.textContent = lines.join("\n");
    statusElement.dataset.done = "true";
    runButton.disabled = false;
  }
}

runButton.addEventListener("click", () => {
  void run();
});
if (new URLSearchParams(location.search).has("autorun")) void run();
