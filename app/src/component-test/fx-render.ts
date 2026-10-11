import { afterAll } from "vitest";
import type { ProjectState } from "../app/types.ts";
import { CompositionRenderer } from "../CompositionPlayer.tsx";
import type { CompositionRendererState } from "../composition-renderer-state.ts";

// Draws frames the way the preview does, with the compositor itself on a
// detached WebGL canvas, and reads their pixels back.

export type Frame = {
  width: number;
  height: number;
  // RGBA rows from the top.
  pixels: Uint8Array;
};

// The renderer's state for `project`, drawn at `width`×`height` when given
// instead of its own output size.
export function rendererState(
  project: ProjectState,
  size?: { width: number; height: number },
): CompositionRendererState {
  return {
    mediaItems: project.mediaItems,
    clips: project.clips,
    lanes: project.lanes,
    effects: project.effects,
    bpm: project.bpm,
    fps: project.fps,
    projectDurationFrames: project.projectDurationFrames,
    canvasWidth: size?.width ?? project.canvasWidth,
    canvasHeight: size?.height ?? project.canvasHeight,
  };
}

// One renderer serves every frame a test file draws: building one compiles
// the compositor's shaders, which takes far longer than a frame.
let shared: CompositionRenderer | undefined;

afterAll(() => {
  shared?.destroy();
  shared = undefined;
});

// One frame of `state` at `playheadQ` (and the matching second at its
// tempo unless given).
export async function renderFrame(
  state: CompositionRendererState,
  playheadQ: number,
  playheadSeconds = (playheadQ * 60) / state.bpm,
): Promise<Frame> {
  if (shared) {
    shared.update(state);
  } else {
    shared = new CompositionRenderer(state, {
      canvas: document.createElement("canvas"),
      audioAnalysis: "offline",
    });
  }
  await shared.renderFrameAt(playheadQ, playheadSeconds);
  return readCanvas(shared.canvas);
}

// The pixels of a WebGL canvas, rows from the top.
export function readCanvas(canvas: HTMLCanvasElement): Frame {
  const gl = canvas.getContext("webgl") ?? canvas.getContext("webgl2");
  if (!gl) {
    throw new Error("WebGL is unavailable.");
  }
  const { width, height } = canvas;
  const flipped = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
  const pixels = new Uint8Array(flipped.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    pixels.set(
      flipped.subarray((height - 1 - y) * row, (height - y) * row),
      y * row,
    );
  }
  return { width, height, pixels };
}

// The RGBA value at (`x`, `y`) from the top left.
export function pixelAt({ width, pixels }: Frame, x: number, y: number) {
  const at = (y * width + x) * 4;
  return Array.from(pixels.subarray(at, at + 4));
}

// Row `y` from the top as RGBA values.
export function rowAt(frame: Frame, y: number) {
  return Array.from({ length: frame.width }, (_, x) => pixelAt(frame, x, y));
}

// Every pixel's gray level, the mean of its color channels.
export function grayLevels({ pixels }: Frame) {
  const gray: number[] = [];
  for (let at = 0; at < pixels.length; at += 4) {
    gray.push((pixels[at] + pixels[at + 1] + pixels[at + 2]) / 3);
  }
  return gray;
}

// How much of the picture changed: the mean difference between two frames'
// gray levels.
export function meanChange(left: Frame, right: Frame) {
  const a = grayLevels(left);
  const b = grayLevels(right);
  return (
    a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) /
    a.length
  );
}
