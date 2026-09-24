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
import { type LayoutAnchor, resolveFrameBounds } from "./composition-layout";

type MediaItem = CompositionRendererState["mediaItems"][number];
type SessionEffect = CompositionRendererState["effects"][number];
type Rgb = [number, number, number];
type Orientation = "portrait" | "landscape";
type EffectMode = "none" | "first-layer" | "all-layers" | "global";

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

const status = document.querySelector<HTMLElement>("#status");
const runButton = document.querySelector<HTMLButtonElement>("#run");
if (!status || !runButton) throw new Error("Missing smoke test elements.");
const statusElement = status;

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
  // The last lane is drawn first (top band), so "first-layer" puts the chain
  // on the layer every other layer is drawn after.
  if (effectMode === "first-layer") {
    effects.push(chainEffect(lanes[lanes.length - 1].id));
  } else if (effectMode === "all-layers") {
    effects.push(...lanes.map((lane) => chainEffect(lane.id)));
  } else if (effectMode === "global") {
    effects.push(chainEffect("__group_main"));
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

function expectedThird(
  anchor: LayoutAnchor,
  orientation: Orientation,
  layerCount: number,
) {
  // A portrait source fills a portrait canvas exactly, and a landscape
  // source is at least as wide as any band, so only portrait sources in
  // shared bands overflow vertically and follow the anchor.
  if (orientation === "landscape" || layerCount === 1) return 1;
  return anchor === "top" ? 0 : anchor === "bottom" ? 2 : 1;
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
  return actual.every((value, index) => Math.abs(value - expected[index]) <= TOLERANCE);
}

async function runCase(
  sources: Array<{ url: string; width: number; height: number }>,
  orientation: Orientation,
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
    const third = expectedThird(anchor, orientation, sources.length);
    for (let band = 0; band < sources.length; band++) {
      // Band 0 is the top band and holds the highest lane.
      const layer = sources.length - 1 - band;
      const bounds = resolveFrameBounds(band, sources.length, 1);
      const top = ((1 - (bounds.centerY + bounds.halfHeight)) / 2) * CANVAS_HEIGHT;
      const bottom = ((1 - (bounds.centerY - bounds.halfHeight)) / 2) * CANVAS_HEIGHT;
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
          (value, index) => value === 0 || Math.abs(pixel[index] - value) <= TOLERANCE,
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
          ] as const) {
            total++;
            const name = `${count} layer(s), ${orientation}, ${anchor}, effects: ${effectMode}`;
            statusElement.textContent = `Rendering ${name}...`;
            const failures = await runCase(
              sources.slice(0, count),
              orientation,
              anchor,
              effectMode,
            );
            if (failures.length) {
              failed++;
              lines.push(`FAIL ${name}`, ...failures.map((line) => `  ${line}`));
            } else {
              lines.push(`ok   ${name}`);
            }
          }
        }
      }
      for (const source of sources) URL.revokeObjectURL(source.url);
    }
    lines.unshift(
      failed ? `FAILED ${failed}/${total} cases` : `PASSED ${total}/${total} cases`,
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
