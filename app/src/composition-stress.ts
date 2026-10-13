// Preview cost of many small animated clips, as a dot-grid wave needs. Start
// the dev server (`pnpm dev`) and open
// http://localhost:1420/composition-stress.html?dots=300&autorun. Each dot is
// a fill clip on its own layer, cut to a Shape and moved by a Transform whose
// LFO has a per-dot phase. The status line reports the median and 95th
// percentile of each frame's CPU time and of its time to finish on the GPU,
// after the first frame, whose time is reported on its own.
import { CompositionRenderer } from "./CompositionPlayer";
import type {
  ArrangementClip,
  Lane,
  SessionEffect,
} from "./composition-active-clips.ts";
import type { CompositionRendererState } from "./composition-renderer-state.ts";

const params = new URLSearchParams(location.search);
const DOTS = Number(params.get("dots") ?? 300);
const FRAMES = Number(params.get("frames") ?? 120);
const WIDTH = Number(params.get("width") ?? 1920);
const HEIGHT = Number(params.get("height") ?? 1080);
const PIXEL_RATIO = Number(params.get("ratio") ?? 1);
// How each dot is made round: "shape" cuts a solid fill to an Oval Shape,
// "gradient" paints a hard-edged radial gradient with no effect, and
// "square" leaves it a square.
const DOT = params.get("dot") ?? "shape";
const DOT_COLOR = "rgba(236,242,240,1)";
const BPM = 80;
const DURATION_SECONDS = 8;

const status = document.getElementById("status") as HTMLPreElement;

function parameter(key: string, value: number | string) {
  return typeof value === "number"
    ? { key, value: String(value), numericValue: value }
    : { key, value };
}

// A grid of dots, each a small circle whose Transform's Position Y follows
// a quarter-note sine LFO a little later in its cycle than the dot before.
export function stressState(dots: number): CompositionRendererState {
  const columns = Math.ceil(Math.sqrt((dots * WIDTH) / HEIGHT));
  const rows = Math.ceil(dots / columns);
  const lanes: Lane[] = [];
  const clips: ArrangementClip[] = [];
  const effects: SessionEffect[] = [];
  for (let index = 0; index < dots; index++) {
    const id = `dot-${index}`;
    const trackId = `clip:${id}`;
    const column = index % columns;
    const row = Math.floor(index / columns);
    lanes.push({ id: `layer-${index}`, name: `Dot ${index}`, colorIndex: 0 });
    clips.push({
      id,
      kind: "fill",
      sourceTrackId: "",
      laneId: `layer-${index}`,
      label: id,
      mediaPath: "",
      startQ: 0,
      durationSeconds: DURATION_SECONDS,
      trimStartSeconds: 0,
      sourceOffsetSeconds: 0,
      sourceWindowStartSeconds: 0,
      sourceWindowEndSeconds: DURATION_SECONDS,
      tint: "#000",
      accent: "#fff",
    });
    effects.push(
      {
        id: `${id}-color`,
        trackId,
        effectName: "Color",
        enabled: true,
        parameters: [
          ...(DOT === "gradient"
            ? [
                parameter("Mode", "Gradient"),
                parameter(
                  "Gradient",
                  `radial-gradient(circle, ${DOT_COLOR} 0%, ${DOT_COLOR} 46%, rgba(0,0,0,0) 48%)`,
                ),
              ]
            : [parameter("Mode", "Solid"), parameter("Color", DOT_COLOR)]),
          parameter("Opacity", 1),
        ],
      },
      {
        id: `${id}-shape`,
        trackId,
        effectName: "Shape",
        enabled: DOT === "shape",
        parameters: [parameter("Shape", "Oval")],
      },
      {
        id: `${id}-transform`,
        trackId,
        effectName: "Transform",
        enabled: true,
        parameters: [
          parameter("PositionX", (column + 0.5) / columns - 0.5),
          parameter("PositionY", (row + 0.5) / rows - 0.5),
          // A gradient's circle is round in a box of the frame's aspect.
          parameter(
            "ScaleX",
            DOT === "gradient" ? 0.8 / rows : (0.4 * HEIGHT) / (WIDTH * rows),
          ),
          parameter("ScaleY", DOT === "gradient" ? 0.8 / rows : 0.4 / rows),
          parameter("OriginX", 0),
          parameter("OriginY", 0),
          parameter("Rotation", 0),
        ],
        animation: {
          enabled: true,
          mode: "lfo",
          clip: {
            motionIn: "Ease Out",
            motionOut: "Ease In",
            timing: "Normal",
          },
          lfo: {
            shape: "Sine",
            sync: true,
            rate: 1,
            syncRate: "1 Bar",
            depth: 0.05,
            phase: (column * 24) % 360,
            parameters: ["PositionY"],
          },
        },
      } as SessionEffect,
    );
  }
  return {
    mediaItems: [],
    clips,
    lanes,
    effects,
    bpm: BPM,
    fps: 30,
    canvasWidth: WIDTH,
    canvasHeight: HEIGHT,
  };
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  ];
}

async function run() {
  const renderer = new CompositionRenderer(stressState(DOTS), {
    audioAnalysis: "offline",
    contextAttributes: { alpha: false, antialias: false },
  });
  document.body.append(renderer.canvas);
  renderer.canvas.style.width = "640px";
  const gl = renderer.canvas.getContext("webgl") as WebGLRenderingContext;
  const pixel = new Uint8Array(4);
  const cpu: number[] = [];
  const total: number[] = [];
  let firstFrame = 0;
  const frameQ = BPM / 60 / 30;
  for (let frame = 0; frame < FRAMES + 10; frame++) {
    await new Promise(requestAnimationFrame);
    const startedAt = performance.now();
    renderer.renderPreviewFrame(frame * frameQ, PIXEL_RATIO, true);
    const drawn = performance.now();
    // Reading a pixel waits for the GPU to finish the frame.
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    const finished = performance.now();
    if (frame === 0) {
      // The first frame rasterizes every fill.
      firstFrame = finished - startedAt;
    } else if (frame >= 10) {
      cpu.push(drawn - startedAt);
      total.push(finished - startedAt);
    }
  }
  const summary = {
    dots: DOTS,
    surface: `${renderer.canvas.width}x${renderer.canvas.height}`,
    firstFrame,
    cpuMedian: percentile(cpu, 0.5),
    cpuP95: percentile(cpu, 0.95),
    gpuMedian: percentile(total, 0.5),
    gpuP95: percentile(total, 0.95),
  };
  // The last frame is drawn again, so it stays on screen, then kept with
  // `keep`.
  renderer.renderPreviewFrame(FRAMES * frameQ, PIXEL_RATIO, false);
  status.textContent = `DONE ${JSON.stringify(summary)}`;
  if (!params.has("keep")) {
    renderer.destroy();
  }
}

document.getElementById("run")?.addEventListener("click", () => void run());
if (params.has("autorun")) {
  void run();
}
