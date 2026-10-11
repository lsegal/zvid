import { page } from "vitest/browser";
import type { CompositionRendererState } from "../composition-renderer-state.ts";
import type { SessionEffect } from "../fx-stack";
import { type Frame, rowAt } from "./fx-render.ts";

// Synthetic frames for the video effects' rendering tests, and the ways the
// e2e specs sampled their previews.

export type Parameter = { key: string; value: string; numericValue?: number };

// `values` as effect parameters, numbers with their numeric value.
export function parameters(
  values: Record<string, string | number>,
): Parameter[] {
  return Object.entries(values).map(([key, value]) =>
    typeof value === "number"
      ? { key, value: String(value), numericValue: value }
      : { key, value },
  );
}

// `effectName` of `parameters` on Layer 1.
export function layerEffect(
  effectName: string,
  parameters: Parameter[],
): SessionEffect {
  return {
    id: `${effectName}-1`,
    trackId: "1",
    effectName,
    enabled: true,
    parameters,
  };
}

// A `width`×`height` frame of one fill clip painted `paint` (a CSS color or
// gradient) on Layer 1 for its first 4 s at 120 BPM, with `effects` after
// its Color on the layer.
export function fillState(
  paint: string,
  effects: SessionEffect[],
  { width, height }: { width: number; height: number },
): CompositionRendererState {
  const gradient = paint.includes("gradient");
  return {
    mediaItems: [],
    clips: [
      {
        id: "fill-1",
        kind: "fill",
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
      },
    ],
    lanes: [{ id: "1", name: "Layer 1", colorIndex: 0 }],
    effects: [
      layerEffect(
        "Color",
        parameters({
          Mode: gradient ? "Gradient" : "Solid",
          [gradient ? "Gradient" : "Color"]: paint,
          Opacity: 1,
        }),
      ),
      ...effects,
    ],
    bpm: 120,
    fps: 30,
    canvasWidth: width,
    canvasHeight: height,
  };
}

// The row the e2e specs read with readPixels at `height / 2`, counted from
// the bottom.
export function middleRow(frame: Frame) {
  return rowAt(frame, frame.height - 1 - Math.floor(frame.height / 2));
}

// The frame scaled down to `size`×`size` as RGB values, as the specs drew
// their preview screenshots onto a small canvas.
export function scaledRgb(frame: Frame, size: number) {
  const full = document.createElement("canvas");
  full.width = frame.width;
  full.height = frame.height;
  const fullContext = full.getContext("2d");
  const small = document.createElement("canvas");
  small.width = size;
  small.height = size;
  const context = small.getContext("2d");
  if (!fullContext || !context) throw new Error("No 2D context");
  fullContext.putImageData(
    new ImageData(
      new Uint8ClampedArray(frame.pixels),
      frame.width,
      frame.height,
    ),
    0,
    0,
  );
  context.drawImage(full, 0, 0, size, size);
  return Array.from(context.getImageData(0, 0, size, size).data).filter(
    (_, index) => index % 4 !== 3,
  );
}

// Every pixel's RGB values.
export function rgb({ pixels }: Frame) {
  return Array.from(pixels).filter((_, index) => index % 4 !== 3);
}

// The mean per-channel difference between two samples, 0-255.
export function meanDifference(
  left: ArrayLike<number>,
  right: ArrayLike<number>,
) {
  let sum = 0;
  for (let index = 0; index < left.length; index++) {
    sum += Math.abs(left[index] - right[index]);
  }
  return sum / left.length;
}

// The largest per-channel difference between two samples, 0-255.
export function maxDifference(
  left: ArrayLike<number>,
  right: ArrayLike<number>,
) {
  let most = 0;
  for (let index = 0; index < left.length; index++) {
    most = Math.max(most, Math.abs(left[index] - right[index]));
  }
  return most;
}

// The frame's mean gray level.
export function meanGray({ pixels }: Frame) {
  let total = 0;
  for (let at = 0; at < pixels.length; at += 4) {
    total += (pixels[at] + pixels[at + 1] + pixels[at + 2]) / 3;
  }
  return total / (pixels.length / 4);
}

// The device panel labeled `name` in stack `group` ("global", "layer" or
// "clip"), whether the panel carries the group itself or, with an
// Animation or Modulation section attached, its wrapper does.
export function stackDevice(name: string, group: string) {
  const element = document.querySelector(
    `.fx-chain :is(section[data-fx-group="${group}"], [data-fx-group="${group}"] > section)[aria-label="${name}"]`,
  );
  if (!element) throw new Error(`No ${name} device in the ${group} stack`);
  return page.elementLocator(element);
}
