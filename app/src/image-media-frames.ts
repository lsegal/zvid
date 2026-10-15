// The pictures image clips draw: a still image, or the frames of an animated
// GIF, WebP, PNG or AVIF, decoded with WebCodecs' ImageDecoder, or of a
// Lottie animation, drawn by its player. A browser without ImageDecoder
// shows an animated image's first frame. Images load
// once per URL; animated ones keep a few decoded frames and decode the one
// a clip needs on demand. A paused preview redraws when one loads.

import type { FrameSpans } from "./fx/effects/retime/retime.ts";
import {
  isLottieName,
  lottieFrameCount,
  lottieFrameIndex,
  lottieSeconds,
} from "./lottie.ts";
import {
  type LottiePlayer,
  lottieFrameUrl,
  openLottie,
} from "./lottie-player.ts";
import { imageMimeType } from "./media.ts";

export type ImageMediaRef = { previewUrl: string; name: string };

export type ImageFrame = {
  image: TexImageSource;
  width: number;
  height: number;
};

// Browsers play GIF frames shorter than this at 100 ms, as old browsers did.
const MIN_FRAME_SECONDS = 0.02;
const DEFAULT_FRAME_SECONDS = 0.1;
// Decoded frames kept per animation, least recently used dropped first.
const KEPT_FRAMES = 16;

type Animation = {
  decoder: ImageDecoder;
  // When each frame ends, in seconds from the animation's start.
  frameEnds: number[];
  width: number;
  height: number;
  frames: Map<number, VideoFrame>;
  decoding: Map<number, Promise<VideoFrame | undefined>>;
  // The frame drawn last, which stands in while the next one decodes.
  shown?: VideoFrame;
};

type LoadedImage =
  | { status: "loading"; promise: Promise<void> }
  | { status: "still"; frame: ImageFrame }
  | { status: "animated"; animation: Animation }
  | { status: "lottie"; player: LottiePlayer }
  | { status: "failed"; reason?: string };

const images = new Map<string, LoadedImage>();
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) {
    listener();
  }
}

/** Calls `listener` when an image or one of its frames finishes loading. */
export function subscribeImageMedia(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function frameSeconds(durationMicroseconds: number | null) {
  const seconds = (durationMicroseconds ?? 0) / 1e6;
  return seconds >= MIN_FRAME_SECONDS ? seconds : DEFAULT_FRAME_SECONDS;
}

/**
 * The index of the frame showing `seconds` into an animation whose frames
 * end at `frameEnds`, looping past its end.
 */
export function animationFrameIndex(
  frameEnds: readonly number[],
  seconds: number,
) {
  const duration = frameEnds[frameEnds.length - 1] ?? 0;
  if (!(duration > 0)) {
    return 0;
  }
  const looped = seconds % duration;
  const time = looped < 0 ? looped + duration : looped;
  let low = 0;
  let high = frameEnds.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (frameEnds[middle] > time) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }
  return low;
}

// The animation in `blob`, with every frame's length read by decoding it
// once, or undefined when it is a still or can't be decoded here.
async function openAnimation(
  blob: Blob,
  type: string,
): Promise<Animation | undefined> {
  if (
    typeof ImageDecoder === "undefined" ||
    !(await ImageDecoder.isTypeSupported(type))
  ) {
    return undefined;
  }
  const decoder = new ImageDecoder({ data: blob.stream(), type });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated) {
      decoder.close();
      return undefined;
    }
    await decoder.completed;
    const frameEnds: number[] = [];
    let width = 0;
    let height = 0;
    for (let index = 0; index < track.frameCount; index++) {
      const { image } = await decoder.decode({ frameIndex: index });
      frameEnds.push(
        (frameEnds[index - 1] ?? 0) + frameSeconds(image.duration),
      );
      width = image.displayWidth;
      height = image.displayHeight;
      image.close();
    }
    if (frameEnds.length < 2) {
      decoder.close();
      return undefined;
    }
    return {
      decoder,
      frameEnds,
      width,
      height,
      frames: new Map(),
      decoding: new Map(),
    };
  } catch {
    decoder.close();
    return undefined;
  }
}

async function loadStill(url: string): Promise<ImageFrame> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  await image.decode();
  return { image, width: image.naturalWidth, height: image.naturalHeight };
}

async function loadImage(url: string, name: string): Promise<LoadedImage> {
  try {
    if (isLottieName(name)) {
      return { status: "lottie", player: await openLottie(url, name) };
    }
    const type = imageMimeType(name);
    if (type && type !== "image/svg+xml" && type !== "image/jpeg") {
      const blob = await (await fetch(url)).blob();
      const animation = await openAnimation(blob, blob.type || type);
      if (animation) {
        return { status: "animated", animation };
      }
    }
    return { status: "still", frame: await loadStill(url) };
  } catch (error) {
    return {
      status: "failed",
      reason: error instanceof Error ? error.message : undefined,
    };
  }
}

function startLoad({ previewUrl, name }: ImageMediaRef) {
  const promise = loadImage(previewUrl, name).then((loaded) => {
    images.set(previewUrl, loaded);
    notify();
  });
  images.set(previewUrl, { status: "loading", promise });
  return promise;
}

async function loaded(media: ImageMediaRef) {
  const current = images.get(media.previewUrl);
  if (!current) {
    await startLoad(media);
  } else if (current.status === "loading") {
    await current.promise;
  }
  return images.get(media.previewUrl);
}

function keepFrame(animation: Animation, index: number, frame: VideoFrame) {
  animation.frames.set(index, frame);
  for (const [oldIndex, oldFrame] of animation.frames) {
    if (animation.frames.size <= KEPT_FRAMES) {
      break;
    }
    animation.frames.delete(oldIndex);
    if (oldFrame !== animation.shown) {
      oldFrame.close();
    }
  }
}

function decodeFrame(animation: Animation, index: number) {
  const pending = animation.decoding.get(index);
  if (pending) {
    return pending;
  }
  const promise = animation.decoder
    .decode({ frameIndex: index })
    .then(({ image }) => {
      keepFrame(animation, index, image);
      return image;
    })
    .catch(() => undefined)
    .finally(() => {
      animation.decoding.delete(index);
    });
  animation.decoding.set(index, promise);
  return promise;
}

function show(animation: Animation, frame: VideoFrame): ImageFrame {
  const previous = animation.shown;
  animation.shown = frame;
  if (
    previous &&
    previous !== frame &&
    ![...animation.frames.values()].includes(previous)
  ) {
    previous.close();
  }
  return { image: frame, width: animation.width, height: animation.height };
}

/**
 * Animation length, in seconds, of the image at `media`, or 0 for a still
 * or an image that won't load.
 */
export async function imageAnimationSeconds(media: ImageMediaRef) {
  const image = await loaded(media);
  if (image?.status === "lottie") {
    return lottieSeconds(image.player.data);
  }
  return image?.status === "animated"
    ? (image.animation.frameEnds[image.animation.frameEnds.length - 1] ?? 0)
    : 0;
}

// The Lottie player for `media`, or the reason it holds none.
async function loadedLottie(media: ImageMediaRef) {
  const image = await loaded(media);
  if (image?.status !== "lottie") {
    throw new Error(
      (image?.status === "failed" && image.reason) || "Not a Lottie animation",
    );
  }
  return image.player;
}

/**
 * The Lottie animation at `media`'s frame `seconds` into it, as a PNG object
 * URL. It throws the reason the frame can't be drawn.
 */
export async function lottieThumbnailUrl(
  media: ImageMediaRef,
  seconds: number,
) {
  const player = await loadedLottie(media);
  return lottieFrameUrl(player, lottieFrameIndex(player.data, seconds));
}

/**
 * The size, length and middle frame, as a PNG object URL, of the Lottie
 * animation at `media`. It throws the reason when `media` holds none. A
 * middle frame that can't be captured is left out; the media drawer draws it
 * again on demand.
 */
export async function lottieMediaDetails(media: ImageMediaRef) {
  const player = await loadedLottie(media);
  const durationSeconds = lottieSeconds(player.data);
  return {
    width: player.width,
    height: player.height,
    durationSeconds,
    thumbnailUrl: await lottieFrameUrl(
      player,
      lottieFrameIndex(player.data, durationSeconds / 2),
    ).catch(() => undefined),
  };
}

/**
 * The frame of `media` to draw `seconds` into it, starting to load what it
 * needs. While an animation's frame decodes, the one drawn last stands in,
 * and a paused preview redraws once it is ready. Undefined until the image
 * has loaded, or when it fails to.
 */
export function imageFrameAt(
  media: ImageMediaRef,
  seconds: number,
): ImageFrame | undefined {
  const image = images.get(media.previewUrl);
  if (!image) {
    void startLoad(media);
    return undefined;
  }
  if (image.status === "still") {
    return image.frame;
  }
  if (image.status === "lottie") {
    const { player } = image;
    return {
      image: player.frame(lottieFrameIndex(player.data, seconds)),
      width: player.width,
      height: player.height,
    };
  }
  if (image.status !== "animated") {
    return undefined;
  }
  const { animation } = image;
  const index = animationFrameIndex(animation.frameEnds, seconds);
  const frame = animation.frames.get(index);
  if (frame) {
    animation.frames.delete(index);
    animation.frames.set(index, frame);
    return show(animation, frame);
  }
  if (!animation.decoding.has(index)) {
    void decodeFrame(animation, index).then((decoded) => decoded && notify());
  }
  return animation.shown && show(animation, animation.shown);
}

/**
 * The frame of `media` showing `seconds` into it and the one after it,
 * looping past its end, or undefined for a still or one not yet loaded.
 */
export function imageFrameSpans(
  media: ImageMediaRef,
  seconds: number,
): FrameSpans | undefined {
  const image = images.get(media.previewUrl);
  if (image?.status === "lottie") {
    const { data } = image.player;
    const index = lottieFrameIndex(data, seconds);
    const span = (at: number) => ({
      start: at / data.fr,
      end: (at + 1) / data.fr,
    });
    return {
      current: span(index),
      next: span((index + 1) % lottieFrameCount(data)),
    };
  }
  if (image?.status !== "animated") {
    return undefined;
  }
  const { frameEnds } = image.animation;
  const index = animationFrameIndex(frameEnds, seconds);
  const span = (at: number) => ({
    start: frameEnds[at - 1] ?? 0,
    end: frameEnds[at],
  });
  return {
    current: span(index),
    next: span((index + 1) % frameEnds.length),
  };
}

/**
 * Loads `media` and decodes its frame at `seconds`, so an exact frame such
 * as an export's draws it with imageFrameAt. A Lottie's frames draw when
 * they are asked for, once it has loaded.
 */
export async function loadImageFrame(media: ImageMediaRef, seconds: number) {
  const image = await loaded(media);
  if (image?.status === "animated") {
    const { animation } = image;
    await decodeFrame(
      animation,
      animationFrameIndex(animation.frameEnds, seconds),
    );
  }
}
