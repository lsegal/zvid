// What an exact frame waits for besides its video: image clips' frames,
// text fonts, the SVGs of Custom shapes and LUTs' .cube files, bundled or
// from the media library. A paused preview redraws when any of them loads.

import type { ActiveClip, SessionEffect } from "./composition-active-clips.ts";
import { bundledLutsIn, customLutMediaPaths } from "./fx/effects/lut/lut.ts";
import {
  loadBundledLuts,
  loadLutFiles,
  subscribeLutMedia,
} from "./fx/effects/lut/lut-media.ts";
import {
  loadShapeSvgs,
  subscribeShapeImages,
} from "./fx/effects/shape/custom-mask.ts";
import { customShapeMediaPaths } from "./fx/effects/shape/shape.ts";
import { loadImageFrame, subscribeImageMedia } from "./image-media-frames.ts";
import { loadTextFaces, subscribeFonts } from "./text-fonts.ts";

export async function loadFrameAssets(
  clips: readonly Pick<
    ActiveClip,
    "text" | "media" | "mediaTime" | "isInBounds" | "blend"
  >[],
  effects: readonly SessionEffect[],
) {
  await Promise.all([
    ...clips
      .filter(({ media, isInBounds }) => isInBounds && media.kind === "image")
      // A Retime's Blend draws the next frame too.
      .flatMap(({ media, mediaTime, blend }) =>
        [mediaTime, ...(blend ? [blend.mediaTime] : [])].map((seconds) =>
          loadImageFrame(media, seconds),
        ),
      ),
    loadTextFaces(clips.map((entry) => entry.text)),
    loadShapeSvgs(customShapeMediaPaths(effects)),
    loadLutFiles(customLutMediaPaths(effects)),
    loadBundledLuts(bundledLutsIn(effects)),
  ]);
}

export function subscribeFrameAssets(listener: () => void) {
  const unsubscribeFonts = subscribeFonts(listener);
  const unsubscribeShapes = subscribeShapeImages(listener);
  const unsubscribeLuts = subscribeLutMedia(listener);
  const unsubscribeImages = subscribeImageMedia(listener);
  return () => {
    unsubscribeImages();
    unsubscribeFonts();
    unsubscribeShapes();
    unsubscribeLuts();
  };
}
