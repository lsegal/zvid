// Reads the picture back at a view-only pass's position in the chain (see
// `EffectPass.analyzes`), for panels that show it, such as Scopes'
// waveform. Only the preview reads back, and only while a panel asks: the
// chain draws the picture into a small target and reads that, so a sample
// is at most 256 × 256 pixels rather than a full frame, taken at most
// FRAME_SAMPLE_RATE times a second per effect.

import type { EffectPass } from "./types.ts";

// The view-only step the chain puts before a pass that `analyzesInput`, to
// read back the picture reaching it: it copies its input as it is.
export const INPUT_SAMPLE_PASS: EffectPass = {
  effectName: "InputSample",
  analyzes: true,
  fragmentSource: `
    uniform sampler2D uTex;
    varying vec2 vUv;

    void main() {
      gl_FragColor = texture2D(uTex, vUv);
    }
  `,
  uniforms: [],
  setUniforms() {},
};

// A picture read back at reduced size: `width` × `height` RGBA pixels,
// bottom row first, as WebGL reads them.
export type FrameSample = {
  width: number;
  height: number;
  pixels: Uint8Array;
};

export type FrameSampleListener = (sample: FrameSample) => void;

// Columns a sample is read back at; its rows keep the picture's aspect.
export const FRAME_SAMPLE_COLUMNS = 256;
export const MAX_FRAME_SAMPLE_ROWS = 256;

// Samples a second, at most, for each effect.
export const FRAME_SAMPLE_RATE = 20;

// The size a `width` × `height` picture is read back at.
export function frameSampleSize(width: number, height: number) {
  const columns = Math.max(
    1,
    Math.min(FRAME_SAMPLE_COLUMNS, Math.round(width)),
  );
  const rows = Math.round((columns * height) / Math.max(1, width));
  return {
    width: columns,
    height: Math.max(
      1,
      Math.min(MAX_FRAME_SAMPLE_ROWS, Math.round(height), rows),
    ),
  };
}

type Subscription = {
  listeners: Set<FrameSampleListener>;
  // When the effect was last sampled, or -Infinity for a new subscription.
  sampledAt: number;
};

// Who wants which effect's picture. The preview's chain asks `wants` as it
// prepares a view-only step and `publish`es what it reads back; panels
// `subscribe` while they are visible.
export class FrameAnalysisHub {
  private subscriptions = new Map<string, Subscription>();
  private readonly interval: number;
  private readonly now: () => number;
  private frameRequests = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: { rate?: number; now?: () => number } = {}) {
    this.interval = 1000 / (options.rate ?? FRAME_SAMPLE_RATE);
    this.now = options.now ?? (() => performance.now());
  }

  // Calls `listener` with each sample of effect `effectId`'s picture until
  // the returned function is called. A paused preview draws a frame for it.
  subscribe(effectId: string, listener: FrameSampleListener) {
    let subscription = this.subscriptions.get(effectId);
    if (!subscription) {
      subscription = { listeners: new Set(), sampledAt: -Infinity };
      this.subscriptions.set(effectId, subscription);
    }
    subscription.listeners.add(listener);
    subscription.sampledAt = -Infinity;
    this.requestFrame();
    return () => {
      const current = this.subscriptions.get(effectId);
      current?.listeners.delete(listener);
      if (current && !current.listeners.size) {
        this.subscriptions.delete(effectId);
      }
    };
  }

  // Whether anything is subscribed at all, so the chain can skip asking.
  get active() {
    return this.subscriptions.size > 0;
  }

  // True when effect `effectId` should be sampled in the frame being drawn:
  // something is subscribed to it and its last sample is old enough. A
  // sample put off for its age is taken in a frame requested for when it is
  // due, so a paused preview still shows its last edit.
  wants(effectId: string) {
    const subscription = this.subscriptions.get(effectId);
    if (!subscription) {
      return false;
    }
    const now = this.now();
    const due = subscription.sampledAt + this.interval;
    if (now < due) {
      this.requestFrame(due - now);
      return false;
    }
    subscription.sampledAt = now;
    return true;
  }

  publish(effectId: string, sample: FrameSample) {
    for (const listener of this.subscriptions.get(effectId)?.listeners ?? []) {
      listener(sample);
    }
  }

  // Calls `request` when a paused preview should draw a frame for a sample.
  // The preview passes one that does nothing while it plays, since playback
  // draws frames anyway.
  onFrameRequest(request: () => void) {
    this.frameRequests.add(request);
    return () => {
      this.frameRequests.delete(request);
    };
  }

  private requestFrame(delay = 0) {
    if (!this.frameRequests.size || this.timer !== null) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const request of this.frameRequests) {
        request();
      }
    }, delay);
  }
}

// The preview's hub. Export never uses one, so it never reads back.
export const previewFrameAnalysis = new FrameAnalysisHub();

// The levels a sample's channels are binned into: 8-bit values.
export const FRAME_LEVELS = 256;

// For each channel (red, green, blue) and column of `sample`, how many of
// the column's pixels sit at each level, at
// `((channel * sample.width) + column) * FRAME_LEVELS + level`.
export function waveformCounts(sample: FrameSample) {
  const { width, height, pixels } = sample;
  const counts = new Uint16Array(3 * width * FRAME_LEVELS);
  const channelStride = width * FRAME_LEVELS;
  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const pixel = (row * width + column) * 4;
      const base = column * FRAME_LEVELS;
      counts[base + pixels[pixel]]++;
      counts[channelStride + base + pixels[pixel + 1]]++;
      counts[2 * channelStride + base + pixels[pixel + 2]]++;
    }
  }
  return counts;
}

// For each channel (red, green, blue), how many of `sample`'s pixels sit at
// each level, at `channel * FRAME_LEVELS + level`.
export function histogramCounts(sample: FrameSample) {
  const { width, height, pixels } = sample;
  const counts = new Uint32Array(3 * FRAME_LEVELS);
  for (let pixel = 0; pixel < width * height * 4; pixel += 4) {
    counts[pixels[pixel]]++;
    counts[FRAME_LEVELS + pixels[pixel + 1]]++;
    counts[2 * FRAME_LEVELS + pixels[pixel + 2]]++;
  }
  return counts;
}

// The ids the preview monitor's Scopes pane subscribes to instead of an
// effect's: the program frame the compositor draws, and the media the Media
// tab plays.
export const PROGRAM_FRAME_ID = "@program";
export const MEDIA_FRAME_ID = "@media";

// Draws pictures into a sample's size to read them back.
let readback: CanvasRenderingContext2D | null = null;

// Publishes `source`'s current picture as `id`'s sample when `hub` wants
// one. A WebGL canvas is read in the task that drew it, before its drawing
// buffer is cleared; a video without a frame yet publishes nothing.
export function publishFrame(
  hub: FrameAnalysisHub | null,
  id: string,
  source: HTMLCanvasElement | OffscreenCanvas | HTMLVideoElement,
) {
  if (!hub?.active) {
    return;
  }
  const isVideo = "videoWidth" in source;
  const width = isVideo ? source.videoWidth : source.width;
  const height = isVideo ? source.videoHeight : source.height;
  if (!width || !height || !hub.wants(id)) {
    return;
  }
  readback ??= document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!readback) {
    return;
  }
  const size = frameSampleSize(width, height);
  readback.canvas.width = size.width;
  readback.canvas.height = size.height;
  let data: Uint8ClampedArray;
  try {
    readback.drawImage(source, 0, 0, size.width, size.height);
    ({ data } = readback.getImageData(0, 0, size.width, size.height));
  } catch {
    // A cross-origin picture can't be read back.
    return;
  }
  // Bottom row first, as WebGL reads them.
  const pixels = new Uint8Array(data.length);
  const stride = size.width * 4;
  for (let row = 0; row < size.height; row++) {
    pixels.set(
      data.subarray(row * stride, (row + 1) * stride),
      (size.height - 1 - row) * stride,
    );
  }
  hub.publish(id, { ...size, pixels });
}
