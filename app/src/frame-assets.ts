// What an exact frame waits for besides its media: text fonts and the SVGs
// of Custom shapes. A paused preview redraws when any of them loads, and
// when a device panel starts showing a histogram, read from a drawn frame.

import type { ActiveClip, SessionEffect } from "./composition-active-clips.ts";
import {
  loadShapeSvgs,
  subscribeShapeImages,
} from "./fx/effects/shape/custom-mask.ts";
import { customShapeMediaPaths } from "./fx/effects/shape/shape.ts";
import { onFrameHistogramWatch } from "./fx-shaders/frame-analysis.ts";
import { loadTextFaces, subscribeFonts } from "./text-fonts.ts";

export async function loadFrameAssets(
  clips: readonly Pick<ActiveClip, "text">[],
  effects: readonly SessionEffect[],
) {
  await Promise.all([
    loadTextFaces(clips.map((entry) => entry.text)),
    loadShapeSvgs(customShapeMediaPaths(effects)),
  ]);
}

export function subscribeFrameAssets(listener: () => void) {
  const unsubscribeFonts = subscribeFonts(listener);
  const unsubscribeShapes = subscribeShapeImages(listener);
  const unsubscribeHistograms = onFrameHistogramWatch(listener);
  return () => {
    unsubscribeFonts();
    unsubscribeShapes();
    unsubscribeHistograms();
  };
}
