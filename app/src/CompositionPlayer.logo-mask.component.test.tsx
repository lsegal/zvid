import { describe, expect, test } from "vitest";
import type { ArrangementClip, Lane } from "./app/types.ts";
import { CompositionRenderer } from "./CompositionPlayer";
import { setShapeImageMedia } from "./fx/effects/shape/custom-mask.ts";
import type { MediaItem } from "./media";
import session from "./sample/zvid-opening.project.json" with { type: "json" };

// The zvid logo (#1070) is the mask the opening sample cuts its 1.5 s shot
// to: the renderer keeps a fill inside the logo and clears it outside.

type Rgba = [number, number, number, number];

const WIDTH = 960;
const HEIGHT = 540;

// The sample's own effects on its logo hold clip, as the renderer takes
// them, on Layer 1.
function holdEffects() {
  return session.effects
    .filter((effect) => effect.trackId === "clip:fill-logo-hold")
    .map((effect) => ({
      id: effect.id,
      trackId: "1",
      effectName: effect.effectName,
      enabled: true,
      parameters: Object.entries(
        effect.parameters as Record<
          string,
          { stringValue?: string; floatValue?: number }
        >,
      ).map(([key, value]) =>
        value.floatValue === undefined
          ? { key, value: value.stringValue ?? "" }
          : {
              key,
              value: String(value.floatValue),
              numericValue: value.floatValue,
            },
      ),
    }));
}

const logoMedia = {
  id: "zvid-sample:opening-v2:zvid-logo",
  name: "zvid-logo.svg",
  kind: "image",
  durationSeconds: 0,
  hasAudio: false,
  hasVideo: false,
  color: "#000",
  accent: "#fff",
  previewUrl: "/samples/opening-v2/zvid-logo.svg",
  availability: "ready",
} as MediaItem;

const fill: ArrangementClip = {
  id: "fill-1",
  kind: "fill",
  sourceSpanId: "",
  sourceTrackId: "",
  laneId: "1",
  label: "Fill",
  mediaPath: "",
  startQ: 0,
  durationSeconds: 4,
  trimStartSeconds: 0,
  sourceOffsetSeconds: 0,
  sourceWindowStartSeconds: 0,
  sourceWindowEndSeconds: 4,
  tint: "#000",
  accent: "#fff",
};

const lanes: Lane[] = [{ id: "1", name: "Layer 1", colorIndex: 0 }];

// A WIDTH×HEIGHT frame of a fill under the sample's logo mask, read at
// `points`, in fractions from the top-left.
async function renderLogoMask(points: Array<[number, number]>) {
  setShapeImageMedia([logoMedia]);
  const canvas = document.createElement("canvas");
  const renderer = new CompositionRenderer(
    {
      mediaItems: [logoMedia],
      clips: [fill],
      lanes,
      effects: holdEffects(),
      bpm: 120,
      canvasWidth: WIDTH,
      canvasHeight: HEIGHT,
    },
    { canvas, audioAnalysis: "offline" },
  );
  try {
    // An exact frame waits for the SVG.
    await renderer.renderFrameAt(1, 0.5);
    const gl = canvas.getContext("webgl");
    if (!gl) throw new Error("WebGL is unavailable.");
    return points.map(([x, y]) => {
      const pixel = new Uint8Array(4);
      // readPixels counts rows from the bottom.
      gl.readPixels(
        Math.floor(x * WIDTH),
        HEIGHT - 1 - Math.floor(y * HEIGHT),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixel,
      );
      return Array.from(pixel) as Rgba;
    });
  } finally {
    renderer.destroy();
    setShapeImageMedia([]);
  }
}

const isLit = ([red]: Rgba) => red > 200;
const isDark = ([red]: Rgba) => red < 25;

// A point of the logo's viewBox (-8 -8 258 212) as a fraction of the frame,
// under the hold's box: 90% of the frame's height, in the logo's aspect,
// centered.
function logoPoint(x: number, y: number): [number, number] {
  const boxHeight = 0.9 * 1080;
  const boxWidth = (boxHeight * 258) / 212;
  return [
    (960 - boxWidth / 2 + ((x + 8) / 258) * boxWidth) / 1920,
    (540 - boxHeight / 2 + ((y + 8) / 212) * boxHeight) / 1080,
  ];
}

describe("the opening sample's logo mask", () => {
  test("keeps the shot inside the logo and clears it outside", async () => {
    const inside = [
      logoPoint(114, 97), // the Z's diagonal
      logoPoint(120, 44), // the top strip, under its sprocket holes
      logoPoint(100, 152), // the bottom strip, above its sprocket holes
    ];
    const outside = [
      logoPoint(133, 26), // a top sprocket hole
      logoPoint(121, 169), // a bottom sprocket hole
      logoPoint(30, 100), // left of the diagonal, between the strips
      [0.05, 0.5],
      [0.95, 0.5],
      [0.5, 0.02],
    ] as Array<[number, number]>;
    const pixels = await renderLogoMask([...inside, ...outside]);
    inside.forEach((point, index) => {
      expect(isLit(pixels[index]), `${point} inside`).toBe(true);
    });
    outside.forEach((point, index) => {
      expect(isDark(pixels[inside.length + index]), `${point} outside`).toBe(
        true,
      );
    });
  });
});
