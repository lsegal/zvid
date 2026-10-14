// What an exact frame waits for besides its video: image clips' frames,
// text fonts, the SVGs of Custom shapes and LUTs' .cube files, bundled or
// from the media library. A paused preview redraws when any of them loads.

import type {
  ActiveClip,
  ArrangementClip,
  MediaItem,
  SessionEffect,
} from "./composition-active-clips.ts";
import type { ClipRetimes } from "./composition-clip-timing.ts";
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
import {
  imageFrameSpans,
  loadImageFrame,
  subscribeImageMedia,
} from "./image-media-frames.ts";
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

// A Retime's Blend reads an animated image's frame lengths as the frame's
// clips are worked out, so an exact frame loads the images it blends first.
export async function loadBlendedImages(
  clips: readonly ArrangementClip[],
  mediaById: ReadonlyMap<string, MediaItem>,
  { byClip }: ClipRetimes,
) {
  const images = clips.flatMap((clip) => {
    const media = clip.mediaId ? mediaById.get(clip.mediaId) : undefined;
    return byClip.get(clip.id)?.interpolation === "Blend" &&
      media?.kind === "image" &&
      !imageFrameSpans(media, 0)
      ? [media]
      : [];
  });
  await Promise.all(images.map((media) => loadImageFrame(media, 0)));
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
