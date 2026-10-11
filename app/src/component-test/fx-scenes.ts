import { CompositionRenderer } from "../CompositionPlayer.tsx";
import type {
  ArrangementClip,
  Lane,
  MediaItem,
} from "../composition-active-clips.ts";
import type { CompositionRendererState } from "../composition-renderer-state.ts";
import { previewFrameAnalysis } from "../fx-shaders/frame-analysis.ts";
import type { SessionEffect } from "../fx-stack";
import { type Frame, pixelAt } from "./fx-render.ts";

// Synthetic frames for the video effects' rendering tests, as the e2e specs
// built them: fill and text clips spanning 0-4 s on numbered layers, and
// a preview that reads back the picture reaching an effect for the panels
// that show it.

export type Rgba = number[];

// A clip of `kind` on layer `laneId` from 0 to 4 s.
export function syntheticClip(
  laneId: string,
  kind: "fill" | "text" | "fx" = "fill",
  extra: Partial<ArrangementClip> = {},
): ArrangementClip {
  return {
    id: `${kind}-${laneId}`,
    kind,
    sourceTrackId: "",
    laneId,
    label: kind,
    mediaPath: "",
    startQ: 0,
    durationSeconds: 4,
    trimStartSeconds: 0,
    sourceOffsetSeconds: 0,
    sourceWindowStartSeconds: 0,
    sourceWindowEndSeconds: 4,
    tint: "#000",
    accent: "#fff",
    ...extra,
  };
}

// The fill of a fill clip on stack `trackId`: a solid CSS color or a
// gradient.
export function colorEffect(trackId: string, paint: string): SessionEffect {
  const gradient = paint.includes("gradient");
  return {
    id: `color-${trackId}`,
    trackId,
    effectName: "Color",
    enabled: true,
    parameters: [
      { key: "Mode", value: gradient ? "Gradient" : "Solid" },
      { key: gradient ? "Gradient" : "Color", value: paint },
      { key: "Opacity", value: "1", numericValue: 1 },
    ],
  };
}

// Layers "1" to `count`.
export function syntheticLanes(count: number): Lane[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${index + 1}`,
    name: `Layer ${index + 1}`,
    colorIndex: index,
  }));
}

// A `width`×`height` frame's renderer state at 120 BPM.
export function syntheticState(
  width: number,
  height: number,
  {
    clips,
    lanes,
    effects,
    mediaItems = [],
  }: {
    clips: ArrangementClip[];
    lanes: Lane[];
    effects: SessionEffect[];
    mediaItems?: MediaItem[];
  },
): CompositionRendererState {
  return {
    mediaItems,
    clips,
    lanes,
    effects,
    bpm: 120,
    fps: 30,
    canvasWidth: width,
    canvasHeight: height,
  };
}

// The pixel at (`x`, `y`), fractions of the frame from its top left.
export function pixelAtFraction(frame: Frame, x: number, y: number): Rgba {
  return pixelAt(
    frame,
    Math.floor(x * frame.width),
    Math.floor(y * frame.height),
  );
}

// The mean red, green and blue of the patch from (`x`, `y`) spanning
// `width`×`height`, all fractions of the frame from its top left.
export function meanColor(
  frame: Frame,
  x: number,
  y: number,
  width: number,
  height: number,
): [number, number, number] {
  const left = Math.round(frame.width * x);
  const top = Math.round(frame.height * y);
  const columns = Math.max(1, Math.round(frame.width * width));
  const rows = Math.max(1, Math.round(frame.height * height));
  const sum = [0, 0, 0];
  for (let row = top; row < top + rows; row++) {
    for (let column = left; column < left + columns; column++) {
      const pixel = pixelAt(frame, column, row);
      sum[0] += pixel[0];
      sum[1] += pixel[1];
      sum[2] += pixel[2];
    }
  }
  const count = columns * rows;
  return [sum[0] / count, sum[1] / count, sum[2] / count];
}

// A paused preview of `read()` at `playheadQ`, drawn whenever a panel asks
// the preview's frame analysis for a new picture, as CompositionPlayer
// redraws for it. Returns a function that stops it.
export function previewForAnalysis(
  read: () => CompositionRendererState,
  playheadQ: number,
) {
  const renderer = new CompositionRenderer(read(), {
    canvas: document.createElement("canvas"),
    audioAnalysis: "offline",
    frameAnalysis: previewFrameAnalysis,
  });
  let drawing = Promise.resolve();
  const stopRequests = previewFrameAnalysis.onFrameRequest(() => {
    drawing = drawing.then(async () => {
      const state = read();
      renderer.update(state);
      await renderer.renderFrameAt(playheadQ, (playheadQ * 60) / state.bpm);
    });
  });
  return async () => {
    stopRequests();
    await drawing;
    renderer.destroy();
  };
}
